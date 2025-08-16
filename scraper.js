// Main file to generate RSS feed
const puppeteer = require('puppeteer');
const fs = require('fs').promises;

async function scrapeInfoWorldProfile(url) {
  const browser = await puppeteer.launch({
    headless: 'new', // Use new headless mode
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // Set a user agent to avoid being blocked
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Loading page...');
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait for articles to load - adjust selector as needed
    await page.waitForSelector('article, .article-item, [class*="article"], [class*="post"], a[href*="/article/"]', {
      timeout: 10000
    }).catch(() => console.log('Article selector timeout - continuing anyway'));

    // Scroll to load more content if needed
    await autoScroll(page);

    console.log('Extracting articles...');
    
    // Extract article data - you may need to adjust these selectors based on actual page structure
    const articles = await page.evaluate(() => {
      const articleData = [];
      
      // Try multiple possible selectors for articles
      const selectors = [
        'article',
        '.article-item',
        '[class*="article-list"] a',
        '[class*="post-list"] > *',
        'a[href*="/article/"]',
        '.content-item',
        '[class*="story"]'
      ];
      
      let elements = [];
      for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) {
          elements = found;
          console.log(`Found ${found.length} elements with selector: ${selector}`);
          break;
        }
      }
      
      // If no specific article elements found, try to find all links that look like articles
      if (elements.length === 0) {
        elements = document.querySelectorAll('a[href*="/article/"], a[href*="/news/"], a[href*="/feature/"]');
      }
      
      elements.forEach(element => {
        try {
          // Extract title - try multiple approaches
          let title = element.querySelector('h2, h3, h4, [class*="title"], [class*="headline"]')?.textContent?.trim() ||
                     element.getAttribute('title') ||
                     element.textContent?.trim();
          
          // Extract URL
          let url = element.href || element.querySelector('a')?.href;
          if (!url && element.tagName === 'A') {
            url = element.getAttribute('href');
          }
          
          // Make URL absolute if it's relative
          if (url && !url.startsWith('http')) {
            url = new URL(url, window.location.origin).href;
          }
          
          // Extract description/summary
          let description = element.querySelector('[class*="summary"], [class*="excerpt"], [class*="description"], p')?.textContent?.trim() || '';
          
          // Extract date if available
          let pubDate = element.querySelector('[class*="date"], time, [datetime]')?.textContent?.trim() ||
                       element.querySelector('time')?.getAttribute('datetime') || '';
          
          // Extract author (should be Sharon Machlis for this profile)
          let author = element.querySelector('[class*="author"], [class*="byline"]')?.textContent?.trim() || 'Sharon Machlis';
          
          // Only add if we have at least a title and URL
          if (title && url && url.includes('infoworld.com')) {
            articleData.push({
              title: title.substring(0, 200), // Limit title length
              url: url,
              description: description.substring(0, 500), // Limit description length
              pubDate: pubDate,
              author: author
            });
          }
        } catch (err) {
          console.error('Error processing element:', err);
        }
      });
      
      // Remove duplicates based on URL
      const uniqueArticles = Array.from(new Map(articleData.map(item => [item.url, item])).values());
      
      return uniqueArticles;
    });

    console.log(`Found ${articles.length} articles`);
    return articles;

  } finally {
    await browser.close();
  }
}

// Helper function to scroll the page to load lazy-loaded content
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if(totalHeight >= scrollHeight - window.innerHeight){
          clearInterval(timer);
          resolve();
        }
      }, 100);
      
      // Stop after 5 seconds max
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, 5000);
    });
  });
}

// Generate RSS XML from articles
function generateRSS(articles, profileUrl) {
  const now = new Date().toUTCString();
  
  let rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Sharon Machlis - InfoWorld Articles</title>
    <link>${profileUrl}</link>
    <description>Latest articles by Sharon Machlis on InfoWorld</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <atom:link href="${profileUrl}/feed.xml" rel="self" type="application/rss+xml" />
`;

  articles.forEach(article => {
    // Clean and escape XML special characters
    const escapeXml = (text) => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };
    
    const title = escapeXml(article.title || 'Untitled');
    const description = escapeXml(article.description || '');
    const author = escapeXml(article.author || 'Sharon Machlis');
    
    // Try to parse the date or use current date
    let pubDate = now;
    if (article.pubDate) {
      try {
        pubDate = new Date(article.pubDate).toUTCString();
        if (pubDate === 'Invalid Date') {
          pubDate = now;
        }
      } catch (e) {
        pubDate = now;
      }
    }
    
    rssContent += `
    <item>
      <title>${title}</title>
      <link>${article.url}</link>
      <description>${description}</description>
      <dc:creator>${author}</dc:creator>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="true">${article.url}</guid>
    </item>`;
  });

  rssContent += `
  </channel>
</rss>`;

  return rssContent;
}

// Main function
async function main() {
  const profileUrl = 'https://www.infoworld.com/profile/sharon-machlis/';
  
  try {
    console.log('Starting RSS feed generation for:', profileUrl);
    
    // Scrape articles
    const articles = await scrapeInfoWorldProfile(profileUrl);
    
    if (articles.length === 0) {
      console.log('No articles found. The page structure might have changed.');
      console.log('You may need to adjust the selectors in the code.');
      return;
    }
    
    // Generate RSS
    const rssContent = generateRSS(articles, profileUrl);
    
    // Save to file
    const filename = 'sharon-machlis-infoworld.xml';
    await fs.writeFile(filename, rssContent, 'utf8');
    
    console.log(`RSS feed generated successfully!`);
    console.log(`Saved to: ${filename}`);
    console.log(`Total articles: ${articles.length}`);
    
    // Print first few articles for verification
    console.log('\nFirst 3 articles in the feed:');
    articles.slice(0, 3).forEach((article, index) => {
      console.log(`\n${index + 1}. ${article.title}`);
      console.log(`   URL: ${article.url}`);
      if (article.pubDate) console.log(`   Date: ${article.pubDate}`);
    });
    
  } catch (error) {
    console.error('Error generating RSS feed:', error);
  }
}

// Run the script
main();

/* 
 * Installation and Usage:
 * 
 * 1. First, install Node.js if you haven't already (https://nodejs.org/)
 * 
 * 2. Install required package:
 *    npm install puppeteer
 * 
 * 3. Save this script as 'infoworld-rss.js'
 * 
 * 4. Run the script:
 *    node infoworld-rss.js
 * 
 * 5. The RSS feed will be saved as 'sharon-machlis-infoworld.xml'
 * 
 * 6. You can then:
 *    - Import this XML file into your RSS reader
 *    - Host it on a web server
 *    - Set up a cron job to regenerate it periodically
 * 
 * Note: If the script doesn't find articles, you may need to inspect
 * the actual page structure and adjust the selectors in the code.
 */
