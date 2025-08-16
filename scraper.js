// Main file to generate RSS feed
// scraper.js - GitHub Actions compatible version
const puppeteer = require('puppeteer');
const fs = require('fs').promises;

async function scrapeInfoWorldProfile(url) {
  // Launch browser with GitHub Actions compatible settings
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`Loading page: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    // Wait a bit for dynamic content
    await page.waitForTimeout(3000);

    // Try to wait for articles to load
    await page.waitForSelector('article, .article-item, [class*="article"], a[href*="/article/"]', {
      timeout: 15000
    }).catch(() => console.log('Article selector timeout - continuing anyway'));

    // Scroll to load more content
    await autoScroll(page);

    console.log('Extracting articles...');
    
    // Extract article data
    const articles = await page.evaluate(() => {
      const articleData = [];
      
      // Try multiple possible selectors
      const selectors = [
        'article a[href*="/article/"]',
        '.article-item',
        '[class*="article-list"] a[href*="/article/"]',
        'main a[href*="/article/"]',
        'a[href*="/article/"]',
        '.content-item',
        '[class*="story"]'
      ];
      
      let elements = new Set();
      for (const selector of selectors) {
        const found = document.querySelectorAll(selector);
        found.forEach(el => elements.add(el));
      }
      
      // Convert Set to Array
      const uniqueElements = Array.from(elements);
      console.log(`Found ${uniqueElements.length} potential article elements`);
      
      uniqueElements.forEach(element => {
        try {
          // Get the link
          let url = element.href || element.querySelector('a')?.href;
          if (!url && element.tagName === 'A') {
            url = element.getAttribute('href');
          }
          
          // Skip if not an article URL
          if (!url || !url.includes('/article/')) {
            return;
          }
          
          // Make URL absolute
          if (!url.startsWith('http')) {
            url = new URL(url, window.location.origin).href;
          }
          
          // Extract title
          let title = element.querySelector('h2, h3, h4, [class*="title"], [class*="headline"]')?.textContent?.trim() ||
                     element.getAttribute('title') ||
                     element.textContent?.trim() ||
                     'Untitled Article';
          
          // Clean up title - remove "Read more" type text
          title = title.replace(/Read more.*$/i, '').replace(/\s+/g, ' ').trim();
          
          // Extract description
          let description = element.querySelector('[class*="summary"], [class*="excerpt"], [class*="description"], p')?.textContent?.trim() || '';
          
          // Extract date
          let pubDate = element.querySelector('[class*="date"], time, [datetime]')?.textContent?.trim() ||
                       element.querySelector('time')?.getAttribute('datetime') || '';
          
          // Only add if we have a valid article URL
          if (url.includes('infoworld.com/article/')) {
            articleData.push({
              title: title.substring(0, 200),
              url: url,
              description: description.substring(0, 500),
              pubDate: pubDate,
              author: 'Sharon Machlis'
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

    console.log(`Extracted ${articles.length} unique articles`);
    
    // If no articles found with specific selectors, try a more general approach
    if (articles.length === 0) {
      console.log('Trying alternative extraction method...');
      const allLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/article/"]'));
        return links.map(link => ({
          title: link.textContent?.trim() || link.getAttribute('title') || 'Article',
          url: link.href,
          description: '',
          pubDate: '',
          author: 'Sharon Machlis'
        })).filter(item => item.url.includes('infoworld.com/article/'));
      });
      
      // Remove duplicates
      const uniqueLinks = Array.from(new Map(allLinks.map(item => [item.url, item])).values());
      return uniqueLinks.slice(0, 50); // Limit to 50 most recent
    }
    
    return articles.slice(0, 50); // Limit to 50 most recent articles

  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Helper function to scroll the page
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
  const buildDate = new Date().toISOString();
  
  let rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Sharon Machlis - InfoWorld Articles</title>
    <link>${profileUrl}</link>
    <description>Latest articles by Sharon Machlis on InfoWorld - Automatically generated RSS feed</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>GitHub Actions RSS Generator</generator>
    <ttl>10080</ttl>
    <atom:link href="https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/feed.xml" rel="self" type="application/rss+xml" />
`;

  articles.forEach((article, index) => {
    // Clean and escape XML special characters
    const escapeXml = (text) => {
      if (!text) return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };
    
    const title = escapeXml(article.title || `Article ${index + 1}`);
    const description = escapeXml(article.description || 'Click to read the full article on InfoWorld.');
    const author = escapeXml(article.author || 'Sharon Machlis');
    
    // Try to parse the date or use current date minus index days (to maintain order)
    let pubDate = now;
    if (article.pubDate) {
      try {
        const parsed = new Date(article.pubDate);
        if (!isNaN(parsed.getTime())) {
          pubDate = parsed.toUTCString();
        }
      } catch (e) {
        // Use a date based on index to maintain order
        const date = new Date();
        date.setDate(date.getDate() - index);
        pubDate = date.toUTCString();
      }
    } else {
      // Use a date based on index to maintain order
      const date = new Date();
      date.setDate(date.getDate() - index);
      pubDate = date.toUTCString();
    }
    
    rssContent += `
    <item>
      <title>${title}</title>
      <link>${article.url}</link>
      <description><![CDATA[${description}]]></description>
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
    console.log('='.repeat(50));
    console.log('RSS Feed Generator for InfoWorld');
    console.log('='.repeat(50));
    console.log(`Target URL: ${profileUrl}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('');
    
    // Scrape articles
    const articles = await scrapeInfoWorldProfile(profileUrl);
    
    if (articles.length === 0) {
      console.error('⚠️  No articles found. The page structure might have changed.');
      console.log('Creating minimal RSS feed...');
      
      // Create a minimal RSS feed even if no articles found
      const minimalRss = generateRSS([{
        title: 'Feed Generation Notice',
        url: profileUrl,
        description: 'The RSS feed generator could not find articles. Please check the source page.',
        pubDate: new Date().toUTCString(),
        author: 'System'
      }], profileUrl);
      
      await fs.writeFile('feed.xml', minimalRss, 'utf8');
      process.exit(0);
    }
    
    // Generate RSS
    const rssContent = generateRSS(articles, profileUrl);
    
    // Save to feed.xml (standard name for RSS feeds)
    await fs.writeFile('feed.xml', rssContent, 'utf8');
    
    console.log('✅ RSS feed generated successfully!');
    console.log(`📄 Saved to: feed.xml`);
    console.log(`📊 Total articles: ${articles.length}`);
    
    // Print first few articles for verification
    console.log('\n📰 First 5 articles in the feed:');
    console.log('-'.repeat(50));
    articles.slice(0, 5).forEach((article, index) => {
      console.log(`${index + 1}. ${article.title}`);
      console.log(`   URL: ${article.url}`);
    });
    
    console.log('\n✨ Done!');
    
  } catch (error) {
    console.error('❌ Error generating RSS feed:', error.message);
    console.error(error.stack);
    
    // Create error RSS feed
    const errorRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Sharon Machlis - InfoWorld Articles</title>
    <link>${profileUrl}</link>
    <description>Error generating feed</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <item>
      <title>Feed Generation Error</title>
      <link>${profileUrl}</link>
      <description>An error occurred while generating the RSS feed. It will retry on the next scheduled run.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;
    
    await fs.writeFile('feed.xml', errorRss, 'utf8');
    process.exit(1);
  }
}

// Run the script
main();
