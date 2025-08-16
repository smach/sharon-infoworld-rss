# InfoWorld RSS Feed Generator

This code will allegedly create an RSS feed of my articles at InfoWorld. It was written by Claude Opus in response to my prompts seeking code to create an RSS feed for my InfoWorld articles using GitHub Actions. Alas Claude preferred to write this in JavaScript instead of R, so I went with that. 😅 This should update every Thursday at 8 AM Eastern Time.


## 📡 Accessing the RSS Feed

Once the workflow runs successfully, anyone can access the RSS feed at:

### Option 1: Raw GitHub URL (Works immediately)
```
https://raw.githubusercontent.com/smach/sharon_infoworld_rss/main/feed.xml
```

### Option 2: GitHub Pages (Better URL, requires setup)

1. Go to Settings → Pages
2. Source: Deploy from a branch
3. Branch: main, folder: / (root)
4. Save

After a few minutes, your feed will be available at:
```
https://smach.github.io/sharon-infoworld-rss/feed.xml
```

## 🔄 RSS Feed URLs



- **Raw URL**: `[https://raw.githubusercontent.com/smach/sharon-infoworld-rss/main/feed.xml](https://raw.githubusercontent.com/smach/sharon-infoworld-rss/refs/heads/main/feed.xml)`
- **GitHub Pages**: `https://smach.github.io/sharon-infoworld-rss/feed.xml`
- **jsDelivr CDN**: `https://cdn.jsdelivr.net/gh/smach/sharon-infoworld-rss@main/feed.xml`

## 📱 Adding to RSS Readers

You can add any of the above URLs to your favorite RSS reader:

- **Feedly**: Add the URL as a new source
- **Inoreader**: Add subscription → Enter URL
- **NewsBlur**: Add Site → Enter URL
- **The Old Reader**: Add subscription → Enter URL
- **Thunderbird**: File → New → Feed Account → Add the URL

