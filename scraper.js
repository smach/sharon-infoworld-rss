// scraper.js - GitHub Actions compatible version
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

    // A more reliable wait: wait for the main content column to appear.
    try {
      await page.waitForSelector('div.main-col', { timeout: 10000 });
      console.log('Main content column found.');
    } catch (e) {
      console.log('Main content column not found, proceeding anyway.');
    }

    // Scroll to load more content
    await autoScroll(page);

    console.log('Extracting articles with robust fallback logic...');
    
    // ======================= ROBUST LOGIC START =======================
    const articles = await page.evaluate(() => {
      let articleData = [];

      // --- Attempt 1: The Ideal, Specific Selector ---
      let articleElements = document.querySelectorAll('div.main-col article.river-well');
      console.log(`Attempt 1: Found ${articleElements.length} articles with 'div.main-col article.river-well'.`);

      // --- Attempt 2: A Broader, More Flexible Selector ---
      if (articleElements.length === 0) {
        console.log("Attempt 1 failed. Trying a broader selector: 'article.river-well'.");
        articleElements = document.querySelectorAll('article.river-well');
        console.log(`Attempt 2: Found ${articleElements.length} articles with 'article.river-well'.`);
      }

      // If Attempts 1 or 2 succeeded, process the found elements
      if (articleElements.length > 0) {
        articleElements.forEach(element => {
          try {
            const urlElement = element.querySelector('h3 a, h2 a');
            const url = urlElement ? new URL(urlElement.href, window.location.origin).href : null;
            
            if (!url || !url.includes('infoworld.com/article/')) return;

            // Only add articles by the correct author from the byline
            const authorElement = element.querySelector('.byline a');
            if (!authorElement || !authorElement.textContent.trim().includes('Sharon Machlis')) {
                return; // Skip if author is not Sharon Machlis
            }

            const title = urlElement ? urlElement.textContent.trim() : 'Untitled Article';
            const description = element.querySelector('.post-excerpt p')?.textContent?.trim() || '';
            const pubDate = element.querySelector('.pub-date time')?.getAttribute('datetime') || 
                            element.querySelector('.pub-date')?.textContent?.trim() || '';
            
            articleData.push({ title, url, description, pubDate, author: 'Sharon Machlis' });
          } catch (err) {
            console.error('Error processing an article element:', err.message);
          }
        });
      }

      // --- Attempt 3: The Failsafe - Grab All Article Links ---
      if (articleData.length === 0) {
        console.log("Attempts 1 & 2 failed. Trying failsafe: find all article links and reconstruct data.");
        const allLinks = document.querySelectorAll('a[href*="/article/"]');
        console.log(`Attempt 3: Found ${allLinks.length} potential article links.`);
        
        allLinks.forEach(link => {
            try {
                const url = new URL(link.href, window.location.origin).href;
                if (!url.includes('infoworld.com/article/')) return;

                // To avoid grabbing unrelated articles, we check the context of the link.
                // We assume if the link is inside a container with your name, it's yours.
                // This is a heuristic, but it's our best last-ditch effort.
                const parentArticle = link.closest('article, .story, .river-well, .content-item');
                if (parentArticle) {
                    const authorElement = parentArticle.querySelector('.byline a');
                    if (authorElement && !authorElement.textContent.trim().includes('Sharon Machlis')) {
                        return; // It's an article, but not yours.
                    }
                }

                const title = link.textContent?.trim().replace(/\s+/g, ' ') || 'Untitled Article';
                // Description and Date are hard to get reliably this way, so we leave them blank.
                if (title && title.length > 5) { // Basic filter for valid titles
                    articleData.push({ title, url, description: '', pubDate: '', author: 'Sharon Machlis' });
                }
            } catch(e) {
                // Ignore errors on invalid links
            }
        });
      }
      
      // Remove duplicates based on URL - crucial for the failsafe method
      const uniqueArticles = Array.from(new Map(articleData.map(item => [item.url, item])).values());
      return uniqueArticles;
    });
    // ======================= ROBUST LOGIC END =======================

    console.log(`Extracted ${articles.length} unique articles.`);
    
    if (articles.length === 0) {
      console.log('All scraping attempts failed. The website may have fundamentally changed.');
      return [];
    }
    
    return articles.slice(0, 50); // Limit to 50 most recent articles

  } catch (error) {
    console.error('Error during scraping:', error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Helper function to scroll the page (unchanged)
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

// Generate RSS XML from articles (unchanged)
function generateRSS(articles, profileUrl) {
  const now = new Date().toUTCString();
  
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
    <atom:link href="https://raw.githubusercontent.com/smachlis/infoworld-rss/main/feed.xml" rel="self" type="application/rss+xml" />
`;

  articles.forEach((article, index) => {
    const title = escapeXml(article.title || `Article ${index + 1}`);
    const description = escapeXml(article.description || 'Click to read the full article on InfoWorld.');
    const author = escapeXml(article.author || 'Sharon Machlis');
    const url = escapeXml(article.url);
    
    let pubDate = now;
    if (article.pubDate) {
      try {
        const parsed = new Date(article.pubDate);
        if (!isNaN(parsed.getTime())) {
          pubDate = parsed.toUTCString();
        } else {
          const date = new Date();
          date.setDate(date.getDate() - index);
          pubDate = date.toUTCString();
        }
      } catch (e) {
        const date = new Date();
        date.setDate(date.getDate() - index);
        pubDate = date.toUTCString();
      }
    } else {
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

// Main function (unchanged)
async function main() {
  const profileUrl = 'https://www.infoworld.com/profile/sharon-machlis/';
  
  try {
    console.log('='.repeat(50));
    console.log('RSS Feed Generator for InfoWorld');
    console.log('='.repeat(50));
    console.log(`Target URL: ${profileUrl}`);
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('');
    
    const articles = await scrapeInfoWorldProfile(profileUrl);
    
    if (!articles || articles.length === 0) {
      console.error('⚠️  No articles found. The page structure might have changed or there were no articles by the specified author.');
      process.exit(0); 
    }
    
    const rssContent = generateRSS(articles, profileUrl);
    await fs.writeFile('feed.xml', rssContent, 'utf8');
    
    console.log('✅ RSS feed generated successfully!');
    console.log(`📄 Saved to: feed.xml`);
    console.log(`📊 Total articles: ${articles.length}`);
    
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
