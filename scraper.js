// scraper.js - GitHub Actions compatible version
// 
// This scraper generates an RSS feed from InfoWorld author Sharon Machlis's profile page.
// It handles JavaScript-rendered content and filters out unrelated articles.
//
// KEY FEATURES:
// - Excludes articles from "Trending", "Popular", "Related" sections
// - Removes author metadata from titles (dates, reading time, categories)
// - Filters out articles by other authors
// - Limits results to prevent including unrelated content
//
// CONFIGURATION:
// - MAX_ARTICLES: Limits the number of articles to prevent including unrelated content
//   from the bottom of the page. Adjust if you're missing articles or getting wrong ones.
// - DEBUG_MODE: Set to true to see detailed extraction information
//
const MAX_ARTICLES = 10;  // Adjust this if needed
const DEBUG_MODE = false;  // Set to true for detailed logging

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
    const debugMode = DEBUG_MODE;
    const articles = await page.evaluate((debugMode) => {
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
          
          // Get the parent container for context
          const parentContainer = element.closest('article, .article-item, [class*="article"], div, section, li');
          
          // Check if this article might be from another author
          // Look for author attribution near the article link
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
          
          // Extract title - be more careful to get just the title
          let title = '';
          
          // First try to find a proper heading element within the parent container or link
          const headingElement = parentContainer?.querySelector('h1, h2, h3, h4, h5, h6') || 
                                element.querySelector('h1, h2, h3, h4, h5, h6');
          if (headingElement) {
            title = headingElement.textContent?.trim() || '';
          }
          
          // If no heading, try title-specific classes
          if (!title) {
            const titleElement = parentContainer?.querySelector('[class*="title"], [class*="headline"]') ||
                               element.querySelector('[class*="title"], [class*="headline"]');
            if (titleElement) {
              title = titleElement.textContent?.trim() || '';
            }
          }
          
          // If still no title, try the link's title attribute or aria-label
          if (!title) {
            title = element.getAttribute('title') || 
                   element.getAttribute('aria-label') || 
                   '';
          }
          
          // Last resort: use the link text, but be careful
          if (!title) {
            title = element.textContent?.trim() || 'Untitled Article';
          }
          
          // Clean up title - remove metadata that got included
          // Remove "By [Author] [Date] [Time] [Categories]" patterns
          title = title.replace(/^By\s+[\w\s]+\s+\w+\s+\d+,\s+\d{4}.*$/i, '').trim();
          
          // If title starts with metadata pattern, extract the real title after it
          const metadataPattern = /^By\s+Sharon\s+Machlis\s+\w+\s+\d+,\s+\d{4}\s+\d+\s+mins?\s+(.+)/i;
          const metadataMatch = title.match(metadataPattern);
          if (metadataMatch && metadataMatch[1]) {
            // The real title is after the metadata
            title = metadataMatch[1].trim();
            // Remove category tags that might be at the end
            title = title.replace(/\s*(Generative AI|Natural Language Processing|R Language|Technology Industry|Developer|Analytics|Data Science|Programming|Software Development)$/gi, '').trim();
          }
          
          // If the entire title is metadata, try to extract just the article title
          if (title.match(/^By\s+Sharon\s+Machlis/i)) {
            // This means we got the whole metadata block - try to find the actual title
            const linkElement = element.tagName === 'A' ? element : element.querySelector('a');
            if (linkElement) {
              // Try to get the URL and extract a title from it
              const urlParts = linkElement.href?.split('/');
              if (urlParts && urlParts.length > 0) {
                const slug = urlParts[urlParts.length - 1]?.replace('.html', '').replace(/-/g, ' ');
                if (slug && !slug.match(/^\d+$/)) {
                  // Convert slug to title case
                  title = slug.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                  ).join(' ');
                }
              }
            }
          }
          
          // Additional cleanup patterns
          const cleanupPatterns = [
            /^By\s+Sharon\s+Machlis\s*/i,  // Remove author byline at start
            /\s*\d+\s+mins?\s*$/i,          // Remove reading time at end
            /\s*\w+\s+\d+,\s+\d{4}\s*$/,   // Remove date at end
            /\s*(Generative AI|Natural Language Processing|R Language|Technology Industry|Developer|Analytics|Data Science|Programming|Software Development|AI|Machine Learning|Cloud Computing|DevOps|Cybersecurity|Web Development|Mobile Development|Blockchain|IoT|Big Data)$/gi,  // Remove categories at end
            /Read more.*$/i,                // Remove "Read more" text
            /\s+/g                          // Normalize whitespace
          ];
          
          cleanupPatterns.forEach(pattern => {
            title = title.replace(pattern, ' ').trim();
          });
          
          // Final cleanup - if title still contains metadata patterns, truncate at first occurrence
          const metadataIndicators = [
            /\s+\w+\s+\d+,\s+\d{4}/,  // Date pattern
            /\s+\d+\s+mins?/i,         // Reading time
            /\s+By\s+/i                // Author byline
          ];
          
          for (const pattern of metadataIndicators) {
            const match = title.match(pattern);
            if (match && match.index && match.index > 10) {  // Keep at least 10 chars
              title = title.substring(0, match.index).trim();
            }
          }
          
          // If title is too short or still looks like metadata, mark as untitled
          if (title.length < 5 || title.match(/^\d+$/) || title.match(/^(By|mins?|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s/i)) {
            if (debugMode) {
              console.log(`Warning: Could not extract proper title for ${url}, using fallback`);
            }
            title = 'Untitled Article';
          }
          
          if (debugMode && title !== 'Untitled Article') {
            console.log(`Extracted title: "${title.substring(0, 60)}..." from ${url}`);
          }
          
          // Extract description - be more selective
          let description = '';
          
          // Try to find a proper summary/excerpt element
          const descSelectors = [
            '[class*="summary"]',
            '[class*="excerpt"]', 
            '[class*="description"]',
            '[class*="dek"]',
            '[class*="standfirst"]',
            '[class*="intro"]',
            '[class*="abstract"]'
          ];
          
          for (const selector of descSelectors) {
            const descElement = parentContainer?.querySelector(selector) || 
                              element.querySelector(selector);
            if (descElement) {
              description = descElement.textContent?.trim() || '';
              if (description && description.length > 20) {
                break;  // Found a good description
              }
            }
          }
          
          // If no description found, try to get first paragraph
          if (!description || description.length < 20) {
            const paragraph = parentContainer?.querySelector('p') || 
                            element.querySelector('p');
            if (paragraph) {
              description = paragraph.textContent?.trim() || '';
            }
          }
          
          // Clean up description - remove author/date metadata if present
          description = description.replace(/^By\s+[\w\s]+\s+\w+\s+\d+,\s+\d{4}.*?(?=\w)/i, '').trim();
          
          // If description is too short or generic, leave it empty
          if (description.length < 20 || 
              description.toLowerCase().includes('click to read') ||
              description.toLowerCase().includes('read more')) {
            description = '';
          }
          
          // Limit description length
          if (description.length > 500) {
            description = description.substring(0, 497) + '...';
          }
          
          // Extract date - look for actual date information
          let pubDate = '';
          
          // Try to find date in various formats
          const dateElement = parentContainer?.querySelector('time, [datetime], [class*="date"], [class*="published"], [class*="timestamp"]') ||
                            element.querySelector('time, [datetime], [class*="date"], [class*="published"], [class*="timestamp"]');
          if (dateElement) {
            // First check for datetime attribute (most reliable)
            pubDate = dateElement.getAttribute('datetime') || dateElement.textContent?.trim() || '';
          }
          
          // If no date element, look for date patterns in text
          if (!pubDate && parentContainer) {
            const datePattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/i;
            const dateMatch = parentContainer.textContent?.match(datePattern);
            if (dateMatch) {
              pubDate = dateMatch[0];
            }
          }
          
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
    }, debugMode);  // Pass debugMode to the evaluate function

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
    const url = escapeXml(article.url);
    
    // Handle description - if empty, provide a simple default
    let description = article.description;
    if (!description || description.length < 10) {
      description = `Read the article "${article.title}" by Sharon Machlis on InfoWorld.`;
    }
    description = escapeXml(description);
    
    const author = escapeXml(article.author || 'Sharon Machlis');
    
    // Try to parse the date
    let pubDate = now;
    if (article.pubDate) {
      try {
        // Handle various date formats
        let dateStr = article.pubDate;
        
        // If it's already a valid date string, use it
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          pubDate = parsed.toUTCString();
        } else {
          // Try to parse "Dec 19, 2024" format
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const dateMatch = dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
          if (dateMatch) {
            const monthIndex = monthNames.indexOf(dateMatch[1]);
            if (monthIndex !== -1) {
              const constructedDate = new Date(
                parseInt(dateMatch[3]), 
                monthIndex, 
                parseInt(dateMatch[2])
              );
              if (!isNaN(constructedDate.getTime())) {
                pubDate = constructedDate.toUTCString();
              }
            }
          }
        }
      } catch (e) {
        // If date parsing fails, use a staggered date based on index
        // This maintains chronological order in the feed
        const date = new Date();
        date.setDate(date.getDate() - (index * 7)); // Space articles by a week
        pubDate = date.toUTCString();
      }
    } else {
      // No date provided - use staggered dates
      const date = new Date();
      date.setDate(date.getDate() - (index * 7)); // Space articles by a week
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
      if (article.pubDate) {
        console.log(`   Date: ${article.pubDate}`);
      }
    });
    
    // Check for potential title extraction issues
    const untitledCount = articles.filter(a => a.title === 'Untitled Article').length;
    if (untitledCount > 0) {
      console.log(`\n⚠️  Warning: ${untitledCount} articles had title extraction issues.`);
      console.log('   Consider enabling DEBUG_MODE in scraper.js to see details.');
    }
    
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
