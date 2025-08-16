// scraper.js - GitHub Actions compatible version
// 
// CONFIGURATION:
// - MAX_ARTICLES: Limits the number of articles to prevent including unrelated content
//   from the bottom of the page. Adjust if you're missing articles or getting wrong ones.
// - EXCLUDE_SECTIONS: CSS selectors for page sections to ignore (trending, related, etc.)
//
const MAX_ARTICLES = 30;  // Adjust this if needed

const puppeteer = require('puppeteer');
const fs = require('fs').promises;

async function scrapeInfoWorldProfile(url) {
  let browser;
  
  try {
    // Launch browser with GitHub Actions compatible settings
    browser = await puppeteer.launch({
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

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`Loading page: ${url}`);
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    // Wait 3 seconds for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Try to wait for articles to load (with timeout catch)
    try {
      await page.waitForSelector('article, .article-item, [class*="article"], a[href*="/article/"]', {
        timeout: 15000
      });
    } catch (e) {
      console.log('Article selector timeout - continuing anyway');
    }

    // Scroll to load more content
    await autoScroll(page);

    console.log('Extracting articles...');
    
    // Extract article data
    const articles = await page.evaluate(() => {
      const articleData = [];
      
      // First, identify and exclude sections that typically contain other authors' content
      const excludeSections = [
        '[class*="trending"]',
        '[class*="popular"]',
        '[class*="more-from"]',
        '[class*="related"]',
        '[class*="recommended"]',
        'aside',
        'footer',
        '[data-section="trending"]',
        '[data-section="popular"]',
        '[class*="sidebar"]'
      ];
      
      // Get all excluded elements
      const excludedElements = new Set();
      excludeSections.forEach(selector => {
        try {
          const sections = document.querySelectorAll(selector);
          sections.forEach(section => {
            // Mark all links within these sections as excluded
            const links = section.querySelectorAll('a');
            links.forEach(link => excludedElements.add(link));
          });
        } catch (e) {
          // Selector might not exist, that's OK
        }
      });
      
      console.log(`Found ${excludedElements.size} links in excluded sections`);
      
      // Try multiple possible selectors for articles
      const selectors = [
        'main article a[href*="/article/"]',
        'main .article-item',
        'main [class*="article-list"] a[href*="/article/"]',
        '[class*="author-articles"] a[href*="/article/"]',
        '[class*="profile"] a[href*="/article/"]',
        'section:not(aside) a[href*="/article/"]',
        'a[href*="/article/"]'
      ];
      
      let elements = new Set();
      for (const selector of selectors) {
        try {
          const found = document.querySelectorAll(selector);
          found.forEach(el => {
            // Only add if not in excluded sections
            if (!excludedElements.has(el)) {
              elements.add(el);
            }
          });
        } catch (e) {
          console.log(`Selector failed: ${selector}`);
        }
      }
      
      // Convert Set to Array
      const uniqueElements = Array.from(elements);
      console.log(`Found ${uniqueElements.length} potential article elements after exclusions`);
      
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
          
          // Check if this article might be from another author
          // Look for author attribution near the article link
          const parentContainer = element.closest('div, article, section, li');
          let possibleAuthorText = '';
          if (parentContainer) {
            possibleAuthorText = parentContainer.textContent || '';
            
            // Check for common patterns indicating other authors
            const otherAuthorPatterns = [
              /by\s+(?!Sharon\s+Machlis)[\w\s]+/i,  // "by [Not Sharon Machlis]"
              /author:\s*(?!Sharon\s+Machlis)[\w\s]+/i,
              /from\s+(?!Sharon\s+Machlis)[\w\s]+/i
            ];
            
            // Skip if we detect another author's name
            for (const pattern of otherAuthorPatterns) {
              if (pattern.test(possibleAuthorText)) {
                console.log(`Skipping article with different author: ${url}`);
                return;
              }
            }
            
            // Skip if the container has text suggesting it's from a different section
            const skipPhrases = [
              'more from infoworld',
              'trending',
              'popular',
              'recommended',
              'you might also like',
              'related articles',
              'also on infoworld',
              'from our partners',
              'sponsored'
            ];
            
            const containerTextLower = possibleAuthorText.toLowerCase();
            for (const phrase of skipPhrases) {
              if (containerTextLower.includes(phrase)) {
                console.log(`Skipping article from "${phrase}" section: ${url}`);
                return;
              }
            }
          }
          
          // Extract title
          let title = element.querySelector('h2, h3, h4, [class*="title"], [class*="headline"]')?.textContent?.trim() ||
                     element.getAttribute('title') ||
                     element.textContent?.trim() ||
                     'Untitled Article';
          
          // Clean up title
          title = title.replace(/Read more.*$/i, '').replace(/\s+/g, ' ').trim();
          
          // Extract description
          let description = element.querySelector('[class*="summary"], [class*="excerpt"], [class*="description"], p')?.textContent?.trim() || '';
          
          // Extract date
          let pubDate = element.querySelector('[class*="date"], time, [datetime]')?.textContent?.trim() ||
                       element.querySelector('time')?.getAttribute('datetime') || '';
          
          // Only add if we have a valid InfoWorld article URL
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
          console.error('Error processing element:', err.message);
        }
      });
      
      // Remove duplicates based on URL
      const uniqueArticles = Array.from(new Map(articleData.map(item => [item.url, item])).values());
      
      return uniqueArticles;
    });

    console.log(`Extracted ${articles.length} unique articles`);
    
    // Limit to first MAX_ARTICLES to avoid including unrelated content at the bottom
    const limitedArticles = articles.slice(0, MAX_ARTICLES);
    
    if (limitedArticles.length < articles.length) {
      console.log(`Limited to first ${MAX_ARTICLES} articles (excluded ${articles.length - MAX_ARTICLES} articles)`);
    }
    
    // If no articles found with specific selectors, try a more general approach
    if (limitedArticles.length === 0) {
      console.log('Trying alternative extraction method...');
      const maxArticles = MAX_ARTICLES; // Pass the constant value
      const allLinks = await page.evaluate((maxArticles) => {
        const links = Array.from(document.querySelectorAll('a[href*="/article/"]'));
        return links.map(link => ({
          title: link.textContent?.trim() || link.getAttribute('title') || 'Article',
          url: link.href,
          description: '',
          pubDate: '',
          author: 'Sharon Machlis'
        })).filter(item => item.url && item.url.includes('infoworld.com/article/')).slice(0, maxArticles);
      }, maxArticles);
      
      // Remove duplicates
      const uniqueLinks = Array.from(new Map(allLinks.map(item => [item.url, item])).values());
      return uniqueLinks;
    }
    
    return limitedArticles;

  } catch (error) {
    console.error('Error during scraping:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function to scroll the page
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const scrollDelay = 100;
      
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, scrollDelay);
      
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
  
  // Escape XML special characters
  const escapeXml = (text) => {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  let rssContent = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Sharon Machlis - InfoWorld Articles</title>
    <link>${escapeXml(profileUrl)}</link>
    <description>Latest articles by Sharon Machlis on InfoWorld - Automatically generated RSS feed</description>
    <language>en-us</language>
    <lastBuildDate>${now}</lastBuildDate>
    <generator>GitHub Actions RSS Generator</generator>
    <ttl>10080</ttl>
    <atom:link href="https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/feed.xml" rel="self" type="application/rss+xml" />
`;

  articles.forEach((article, index) => {
    const title = escapeXml(article.title || `Article ${index + 1}`);
    const description = escapeXml(article.description || 'Click to read the full article on InfoWorld.');
    const author = escapeXml(article.author || 'Sharon Machlis');
    const url = escapeXml(article.url);
    
    // Try to parse the date or use current date minus index days
    let pubDate = now;
    if (article.pubDate) {
      try {
        const parsed = new Date(article.pubDate);
        if (!isNaN(parsed.getTime())) {
          pubDate = parsed.toUTCString();
        } else {
          // Fallback date
          const date = new Date();
          date.setDate(date.getDate() - index);
          pubDate = date.toUTCString();
        }
      } catch (e) {
        // Fallback date
        const date = new Date();
        date.setDate(date.getDate() - index);
        pubDate = date.toUTCString();
      }
    } else {
      // Use date based on index to maintain order
      const date = new Date();
      date.setDate(date.getDate() - index);
      pubDate = date.toUTCString();
    }
    
    rssContent += `
    <item>
      <title>${title}</title>
      <link>${url}</link>
      <description><![CDATA[${description}]]></description>
      <dc:creator>${author}</dc:creator>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="true">${url}</guid>
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
    
    if (!articles || articles.length === 0) {
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
      console.log('Minimal feed created.');
      process.exit(0);
    }
    
    // Generate RSS
    const rssContent = generateRSS(articles, profileUrl);
    
    // Save to feed.xml
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
