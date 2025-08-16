# scraper.R - GitHub Actions compatible version written by Claude Opus 4.1
#
# This scraper generates an RSS feed from InfoWorld author profile pages.
# It handles JavaScript-rendered content and filters out unrelated articles.
#
# CONFIGURATION:
# - MAX_ARTICLES: Limits the number of articles to prevent including unrelated content
# - DEBUG_MODE: Set to TRUE to see detailed extraction information

# Load required libraries with error checking
required_packages <- c("chromote", "rvest", "xml2", "stringr", "lubridate", "jsonlite")
for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    cat(paste0("Installing missing package: ", pkg, "\n"))
    install.packages(pkg)
  }
  library(pkg, character.only = TRUE)
}

# Configuration
MAX_ARTICLES <- 10  # Adjust this if needed
DEBUG_MODE <- FALSE  # Set to TRUE for detailed logging

# Helper function to escape XML special characters
escape_xml <- function(text) {
  if (is.null(text) || is.na(text) || text == "") return("")
  text %>%
    str_replace_all("&", "&amp;") %>%
    str_replace_all("<", "&lt;") %>%
    str_replace_all(">", "&gt;") %>%
    str_replace_all('"', "&quot;") %>%
    str_replace_all("'", "&apos;")
}

# Safe JSON parsing function
safe_parse_json <- function(json_str) {
  tryCatch({
    if (is.null(json_str) || json_str == "") {
      return(data.frame())
    }
    result <- jsonlite::fromJSON(json_str)
    if (is.null(result)) {
      return(data.frame())
    }
    return(result)
  }, error = function(e) {
    cat(paste0("JSON parsing error: ", e$message, "\n"))
    return(data.frame())
  })
}

# Main scraping function with comprehensive error handling
scrape_infoworld_profile <- function(url) {
  b <- NULL

  tryCatch({
    # Detect if running in CI/GitHub Actions
    is_ci <- Sys.getenv("CI") == "true" || Sys.getenv("GITHUB_ACTIONS") == "true"

    # Launch Chrome with appropriate settings
    if (is_ci) {
      cat("Running in CI environment...\n")
      b <- ChromoteSession$new(
        chromote = Chromote$new(
          browser = Chrome$new(args = c(
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--disable-gpu",
            "--headless"
          ))
        )
      )
    } else {
      cat("Running locally...\n")
      b <- ChromoteSession$new()
    }

    # Give Chrome time to initialize
    Sys.sleep(2)

    cat(paste0("Loading page: ", url, "\n"))

    # Navigate to the page with error handling
    nav_result <- tryCatch({
      b$Page$navigate(url)
      b$Page$loadEventFired()
      TRUE
    }, error = function(e) {
      cat(paste0("Navigation warning: ", e$message, "\n"))
      FALSE
    })

    if (!nav_result) {
      cat("Navigation may have issues, continuing anyway...\n")
    }

    # Wait for content to load
    Sys.sleep(5)

    # Simple scroll to trigger lazy loading
    tryCatch({
      b$Runtime$evaluate(
        expression = "window.scrollTo(0, document.body.scrollHeight || 5000);"
      )
      Sys.sleep(2)
    }, error = function(e) {
      cat("Scroll skipped\n")
    })

    cat("Extracting articles...\n")

    # Simplified extraction - break into smaller, safer operations
    # First, just get the HTML content
    html_result <- tryCatch({
      b$Runtime$evaluate(
        expression = "document.documentElement.outerHTML",
        returnByValue = TRUE
      )
    }, error = function(e) {
      cat(paste0("Failed to get HTML: ", e$message, "\n"))
      list(result = list(value = ""))
    })

    # Parse HTML with rvest as backup
    if (!is.null(html_result$result$value) && html_result$result$value != "") {
      # Try JavaScript extraction first
      js_result <- tryCatch({
        b$Runtime$evaluate(
          expression = '
            (() => {
              const articles = [];
              const seenUrls = new Set();

              // Get all article links
              const links = document.querySelectorAll("a[href*=\\"/article/\\"]");

              for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const href = link.href || "";

                // Skip if not InfoWorld article or already seen
                if (!href.includes("infoworld.com/article/") || seenUrls.has(href)) {
                  continue;
                }
                seenUrls.add(href);

                // Get the link text
                let fullText = link.textContent || "";

                // Normalize whitespace
                fullText = fullText.replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ");
                fullText = fullText.replace(/\\s+/g, " ").trim();

                let title = "";
                let description = "";

                // Special handling for featured article that has title + description concatenated
                // Look for patterns where description starts with "See how", "Learn", "Discover", etc.
                const descriptionStartPattern = /(.*?)\\s+(See how|Learn how|Discover|Find out|Explore|Get|Understand|Master|How to save)/i;
                const match = fullText.match(descriptionStartPattern);

                if (match && match[1] && match[1].length > 10 && match[1].length < 100) {
                  // We found a likely split point
                  title = match[1].trim();
                  description = fullText.substring(match[0].length - match[2].length).trim();

                  // Validate that this makes sense
                  if (description.length > 250) {
                    description = description.substring(0, 247) + "...";
                  }
                } else {
                  // No clear split found, treat it all as title
                  title = fullText;
                  description = "";
                }

                // Clean up the title
                title = title.replace(/^(how-to|feature|news|analysis|opinion|review)\\s+/gi, "").trim();
                title = title.replace(/\\s+By\\s+Sharon\\s+Machlis.*$/i, "").trim();
                title = title.replace(/\\s+By\\s+[A-Za-z]+\\s+[A-Za-z]+.*$/i, "").trim();
                title = title.replace(/\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d+,\\s+\\d{4}.*$/i, "").trim();
                title = title.replace(/\\s+\\d+\\s+mins?\\s*$/i, "").trim();
                title = title.replace(/\\s*(Development Tools|Generative AI|R Language|Programming Languages|Artificial Intelligence|Python|Analytics|Data Science|Technology Industry|Natural Language Processing)+$/gi, "").trim();

                // Clean up description if we found one
                if (description) {
                  description = description.replace(/\\s+By\\s+Sharon\\s+Machlis.*$/i, "").trim();
                  description = description.replace(/\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d+,\\s+\\d{4}.*$/i, "").trim();
                  description = description.replace(/\\s+\\d+\\s+mins?\\s*$/i, "").trim();
                  description = description.replace(/\\s*(Development Tools|Generative AI|R Language|mins)+$/gi, "").trim();

                  // Remove "Plus, " or "Also, " from start of description continuation
                  description = description.replace(/^(Plus,?|Also,?)\\s+/i, "").trim();

                  // Clear description if its too short or looks like tags
                  if (description.length < 20 ||
                      description.match(/^(Development Tools|Generative AI|R Language|Programming|Tools|mins)$/i)) {
                    description = "";
                  }
                }

                // If title is still too long (has description in it) and no description found
                // Try to truncate at a reasonable point
                if (title.length > 100 && !description) {
                  // Look for a good break point
                  const cutPoint = title.indexOf(" See how");
                  if (cutPoint > 0 && cutPoint < 100) {
                    description = title.substring(cutPoint + 1).trim();
                    title = title.substring(0, cutPoint).trim();

                    if (description.length > 250) {
                      description = description.substring(0, 247) + "...";
                    }
                  } else {
                    // Just truncate the title
                    title = title.substring(0, 97) + "...";
                  }
                }

                // If title is empty, extract from URL
                if (!title || title.length < 3) {
                  const urlMatch = href.match(/\\/([^\\/]+)\\.html$/);
                  if (urlMatch) {
                    title = urlMatch[1]
                      .replace(/-/g, " ")
                      .split(" ")
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(" ");
                  } else {
                    title = "InfoWorld Article";
                  }
                }

                // Create article object
                articles.push({
                  title: title,
                  url: href,
                  description: description || "",
                  pubDate: "",
                  author: "Sharon Machlis"
                });

                if (articles.length >= 40) break;
              }

              return JSON.stringify(articles);
            })()
          ',
          returnByValue = TRUE
        )
      }, error = function(e) {
        cat(paste0("JavaScript extraction failed: ", e$message, "\n"))
        NULL
      })

      # Parse JavaScript result
      articles <- data.frame()
      if (!is.null(js_result) && !is.null(js_result$result$value)) {
        articles <- safe_parse_json(js_result$result$value)
      }

      # If JavaScript extraction failed or returned nothing, try rvest
      if (nrow(articles) == 0) {
        cat("Trying rvest extraction as fallback...\n")
        tryCatch({
          html_doc <- read_html(html_result$result$value)
          links <- html_nodes(html_doc, "a[href*='/article/']")

          articles <- data.frame(
            title = html_text(links, trim = TRUE),
            url = html_attr(links, "href"),
            description = "",
            pubDate = "",
            author = "Sharon Machlis",
            stringsAsFactors = FALSE
          )

          # Clean titles without pipes
          if (nrow(articles) > 0) {
            for (i in 1:nrow(articles)) {
              title <- articles$title[i]
              title <- gsub("\\s+", " ", title)  # Normalize whitespace
              title <- sub("^(how-to|feature|news|analysis|opinion|review)\\s+", "", title, ignore.case = TRUE)
              title <- sub("By\\s+Sharon\\s+Machlis.*$", "", title, ignore.case = TRUE)
              title <- sub("By\\s+[A-Za-z]+\\s+[A-Za-z]+.*$", "", title, ignore.case = TRUE)
              title <- sub("(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2},\\s+\\d{4}.*$", "", title, ignore.case = TRUE)
              title <- sub("\\d+\\s+mins?\\s*$", "", title, ignore.case = TRUE)
              articles$title[i] <- trimws(title)
            }
          }

          # Clean URLs
          articles$url <- ifelse(startsWith(articles$url, "http"),
                                 articles$url,
                                 paste0("https://www.infoworld.com", articles$url))

          # Filter for InfoWorld articles
          articles <- articles[grepl("infoworld.com/article/", articles$url), ]

          # Remove duplicates
          articles <- articles[!duplicated(articles$url), ]

        }, error = function(e) {
          cat(paste0("Rvest extraction also failed: ", e$message, "\n"))
        })
      }

    } else {
      cat("Could not retrieve page HTML\n")
      articles <- data.frame()
    }

    # Ensure we have a valid data frame
    if (!is.data.frame(articles)) {
      articles <- data.frame()
    }

    # Additional title cleaning for any remaining issues
    if (nrow(articles) > 0 && "title" %in% names(articles)) {
      # Clean each title
      for (i in 1:nrow(articles)) {
        title <- articles$title[i]
        if (!is.na(title)) {
          # Normalize whitespace
          title <- gsub("\\s+", " ", title)
          title <- gsub("\\t+", " ", title)
          title <- gsub("\\n+", " ", title)
          title <- trimws(title)

          # Remove category labels
          title <- sub("^(how-to|feature|news|analysis|opinion|review)\\s+", "", title, ignore.case = TRUE)

          # Remove author and date metadata
          title <- sub("By\\s+Sharon\\s+Machlis.*$", "", title, ignore.case = TRUE)
          title <- sub("By\\s+[A-Za-z]+\\s+[A-Za-z]+.*$", "", title, ignore.case = TRUE)
          title <- sub("(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2},\\s+\\d{4}.*$", "", title, ignore.case = TRUE)
          title <- sub("\\d+\\s+mins?\\s*$", "", title, ignore.case = TRUE)

          # Trim again after removals
          title <- trimws(title)

          # Update the title
          articles$title[i] <- if(title == "" || is.na(title)) "InfoWorld Article" else title
        }
      }
    }

    # Limit articles
    if (nrow(articles) > MAX_ARTICLES) {
      articles <- articles[1:MAX_ARTICLES, ]
    }

    cat(paste0("Extracted ", nrow(articles), " articles\n"))

    return(articles)

  }, error = function(e) {
    cat(paste0("Error during scraping: ", e$message, "\n"))
    return(data.frame())

  }, finally = {
    # Always try to close the browser
    if (!is.null(b)) {
      tryCatch({
        b$close()
      }, error = function(e) {
        cat("Note: Browser close warning (can be ignored)\n")
      })
    }
  })
}

# Generate RSS XML from articles
generate_rss <- function(articles, profile_url) {
  now <- format(Sys.time(), "%a, %d %b %Y %H:%M:%S GMT", tz = "GMT")

  # Start RSS content
  rss_content <- paste0(
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">\n',
    '  <channel>\n',
    '    <title>Sharon Machlis - InfoWorld Articles</title>\n',
    '    <link>', escape_xml(profile_url), '</link>\n',
    '    <description>Latest articles by Sharon Machlis on InfoWorld - Automatically generated RSS feed</description>\n',
    '    <language>en-us</language>\n',
    '    <lastBuildDate>', now, '</lastBuildDate>\n',
    '    <generator>GitHub Actions RSS Generator</generator>\n',
    '    <ttl>10080</ttl>\n',
    '    <atom:link href="https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/feed.xml" rel="self" type="application/rss+xml" />\n'
  )

  # Add articles if we have any
  if (!is.null(articles) && is.data.frame(articles) && nrow(articles) > 0) {
    for (i in 1:nrow(articles)) {
      tryCatch({
        article <- articles[i, ]

        # Safely extract fields with defaults
        title <- if (!is.null(article$title) && !is.na(article$title)) {
          escape_xml(article$title)
        } else {
          paste0("Article ", i)
        }

        url <- if (!is.null(article$url) && !is.na(article$url)) {
          escape_xml(article$url)
        } else {
          profile_url
        }

        description <- if (!is.null(article$description) && !is.na(article$description) && article$description != "") {
          escape_xml(article$description)
        } else {
          # Leave empty - cleaner than generic text
          ""
        }

        author <- "Sharon Machlis"

        # Simple date handling
        pub_date <- now
        if (!is.null(article$pubDate) && !is.na(article$pubDate) && article$pubDate != "") {
          tryCatch({
            parsed <- as.Date(article$pubDate)
            if (!is.na(parsed)) {
              pub_date <- format(parsed, "%a, %d %b %Y %H:%M:%S GMT", tz = "GMT")
            }
          }, error = function(e) {
            # Use staggered date on parse error
            pub_date <- format(Sys.time() - (i * 7 * 24 * 60 * 60),
                               "%a, %d %b %Y %H:%M:%S GMT", tz = "GMT")
          })
        }

        # Add item to RSS (description element present but can be empty)
        rss_content <- paste0(
          rss_content,
          '\n    <item>\n',
          '      <title>', title, '</title>\n',
          '      <link>', url, '</link>\n',
          '      <description><![CDATA[', description, ']]></description>\n',
          '      <dc:creator>', author, '</dc:creator>\n',
          '      <pubDate>', pub_date, '</pubDate>\n',
          '      <guid isPermaLink="true">', url, '</guid>\n',
          '    </item>'
        )
      }, error = function(e) {
        cat(paste0("Warning: Skipped article ", i, " due to error\n"))
      })
    }
  }

  # Close RSS
  rss_content <- paste0(
    rss_content,
    '\n  </channel>\n',
    '</rss>'
  )

  return(rss_content)
}

# Main function
main <- function(profile_url = "https://www.infoworld.com/profile/sharon-machlis/") {

  tryCatch({
    cat(paste0(strrep("=", 50), "\n"))
    cat("RSS Feed Generator for InfoWorld\n")
    cat(paste0(strrep("=", 50), "\n"))
    cat(paste0("Target URL: ", profile_url, "\n"))
    cat(paste0("Time: ", Sys.time(), "\n\n"))

    # Scrape articles
    articles <- scrape_infoworld_profile(profile_url)

    # Generate RSS even if no articles found
    if (is.null(articles) || !is.data.frame(articles) || nrow(articles) == 0) {
      cat("⚠️  No articles found. Creating minimal RSS feed...\n")

      articles <- data.frame(
        title = "Feed Update",
        url = profile_url,
        description = "Check the InfoWorld profile page for the latest articles.",
        pubDate = "",
        author = "Sharon Machlis",
        stringsAsFactors = FALSE
      )
    }

    # Generate RSS
    rss_content <- generate_rss(articles, profile_url)

    # Save to file
    tryCatch({
      writeLines(rss_content, "feed.xml", useBytes = TRUE)
      cat("✅ RSS feed saved to feed.xml\n")
    }, error = function(e) {
      cat(paste0("Error saving file: ", e$message, "\n"))
      cat("RSS content:\n")
      cat(rss_content)
    })

    # Print summary
    if (nrow(articles) > 0) {
      cat(paste0("📊 Total articles: ", nrow(articles), "\n\n"))
      cat("📰 First few articles:\n")
      cat(paste0(strrep("-", 50), "\n"))

      for (i in 1:min(3, nrow(articles))) {
        cat(paste0(i, ". ", substr(articles$title[i], 1, 60), "\n"))
      }
    }

    cat("\n✨ Script completed!\n")

  }, error = function(e) {
    cat(paste0("❌ Fatal error: ", e$message, "\n"))

    # Create error RSS
    error_rss <- paste0(
      '<?xml version="1.0" encoding="UTF-8"?>\n',
      '<rss version="2.0">\n',
      '  <channel>\n',
      '    <title>Sharon Machlis - InfoWorld Articles</title>\n',
      '    <link>', profile_url, '</link>\n',
      '    <description>Error generating feed</description>\n',
      '    <lastBuildDate>', format(Sys.time(), "%a, %d %b %Y %H:%M:%S GMT", tz = "GMT"), '</lastBuildDate>\n',
      '    <item>\n',
      '      <title>Feed Generation Error</title>\n',
      '      <link>', profile_url, '</link>\n',
      '      <description>Error occurred. Will retry on next run.</description>\n',
      '      <pubDate>', format(Sys.time(), "%a, %d %b %Y %H:%M:%S GMT", tz = "GMT"), '</pubDate>\n',
      '    </item>\n',
      '  </channel>\n',
      '</rss>'
    )

    tryCatch({
      writeLines(error_rss, "feed.xml", useBytes = TRUE)
    }, error = function(e2) {
      cat("Could not write error RSS\n")
    })
  })

  # Don't use quit() as it crashes the R session!
  # Return instead for scripts, or just end naturally
  invisible(NULL)
}

# Run the script only if this is the main script being sourced
if (!interactive() || length(commandArgs(trailingOnly = TRUE)) > 0) {
  main()
} else {
  cat("Script loaded. Run main() to execute.\n")
}
