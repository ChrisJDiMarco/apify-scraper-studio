export const RECIPE_TEMPLATES = [
  {
    id: 'reddit',
    label: 'Reddit',
    name: 'Subreddit pulse',
    platform: 'reddit',
    proxyNote: 'Use the Actor proxy configuration for logged-in or high-volume runs.',
    input: {
      startUrls: [{ url: 'https://www.reddit.com/r/apify/' }],
      searchTerms: [],
      maxItems: 100,
    },
    mapper: {
      text: ['body', 'text', 'title'],
      author: ['author', 'username'],
      url: ['url', 'permalink'],
      timestamp: ['createdAt', 'createdUtc'],
    },
  },
  {
    id: 'x',
    label: 'X',
    name: 'X search scan',
    platform: 'x',
    proxyNote: 'Account cookies, if required by the Actor, stay inside the Actor input and are redacted locally.',
    input: {
      searchTerms: ['apify'],
      startUrls: [],
      maxItems: 100,
    },
    mapper: {
      text: ['text', 'fullText'],
      author: ['author', 'userName', 'username'],
      url: ['url', 'tweetUrl'],
      timestamp: ['createdAt'],
    },
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    name: 'LinkedIn account intelligence',
    platform: 'linkedin',
    proxyNote: 'Use saved Apify tasks for session-heavy LinkedIn workflows.',
    input: {
      startUrls: [{ url: 'https://www.linkedin.com/company/apify/' }],
      maxItems: 100,
    },
    mapper: {
      text: ['text', 'commentary', 'description'],
      author: ['authorName', 'profileName', 'companyName'],
      url: ['url', 'postUrl'],
      timestamp: ['postedAt', 'createdAt'],
    },
  },
  {
    id: 'web',
    label: 'Web',
    name: 'Website change scan',
    platform: 'web',
    proxyNote: 'Use datacenter proxy first; upgrade inside the Actor input only when the target requires it.',
    input: {
      startUrls: [{ url: 'https://apify.com/change-log' }],
      maxRequestsPerCrawl: 25,
    },
    mapper: {
      text: ['text', 'title', 'description'],
      author: ['author'],
      url: ['url'],
      timestamp: ['publishedAt', 'modifiedAt'],
    },
  },
];
