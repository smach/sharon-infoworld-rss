# InfoWorld RSS Feed Generator

This code will allegedly create an RSS feed of my articles at InfoWorld. It was written by Claude Opus in response to my prompts seeking code to create an RSS feed for my InfoWorld articles using GitHub Actions. Alas Claude preferred to write this in JavaScript instead of R, so I went with that. 😅 This should update every Thursday at 8 AM Eastern Time.

**The format of some of the articles is wrong, showing byline where the title should be** Working on that but I've reached my Claude limit for awhile. 

## 📡 Accessing the RSS Feed

In theory, anyone can access the RSS feed at: [https://smach.github.io/sharon-infoworld-rss/feed.xml](https://smach.github.io/sharon-infoworld-rss/feed.xml)

_Update: Claude did write me an R script to generate the RSS feed. The GitHub Action is taking a long time to debug and even run, so I'm sticking with the JavaScript version for actually creating the RSS feed._

## 📱 Adding to RSS Readers

You can add the feed URL to your favorite RSS reader:

- **Feedly**: Add the URL as a new source
- **Inoreader**: Add subscription → Enter URL
- **NewsBlur**: Add Site → Enter URL
- **The Old Reader**: Add subscription → Enter URL
- **Thunderbird**: File → New → Feed Account → Add the URL

