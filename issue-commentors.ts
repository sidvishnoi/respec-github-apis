// Gets GitHub login names of all the commentors to a particular repo
//
// NOTE: This API can be really slow as it'll traverse a lot of pages depending
// on issue comment history. So, it's not recommended to use it. Keeping this
// for a reference only.
//
// NOTE: ALso, listing all issue commentors probably doesn't make much sense.
// They might be spammers who shouldn't be treated as contributors just because
// they commented on an issue.

import { requestData } from './utils/rest.js';
import { TTLCache, ImmutableCache } from './utils/cache.js';

interface Comment {
  [key: string]: any;
  user: {
    login: string;
  };
  created_at: string;
  author_association: string;
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const cache = new TTLCache<string, string[]>(CACHE_TTL);

interface PersistantCacheEntry {
  commentors: string[];
  endpoint: string;
}
const persistantCachePromise = new ImmutableCache<string, PersistantCacheEntry>(
  'gh/issue-commentors',
).load();

const getEndpoint = (owner: string, repo: string) =>
  new URL(`https://api.github.com/repos/${owner}/${repo}/issues/comments`);

/**
 * Gets GitHub login names of all the commentors to a particular repo
 * @param owner organisation/user, e.g. `"w3c"`
 * @param repo repository name, e.g. `"payment-request"`
 */
export async function* getIssueCommentors(owner: string, repo: string) {
  const cacheKey = `${owner}-${repo}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    yield* cached;
    return;
  }

  const lastCommentURL = getEndpoint(owner, repo);
  const persistantCache = await persistantCachePromise;
  const { endpoint, commentors } = persistantCache.get(cacheKey, true) || {
    endpoint: getEndpoint(owner, repo).href,
    commentors: [],
  };

  const uniqueCommentors = new Set<string>(commentors);
  yield* commentors; // previously cached results

  for await (const { result: comments } of requestData(endpoint, 100)) {
    for (const comment of comments as Comment[]) {
      const { login } = comment.user;
      if (!uniqueCommentors.has(login)) {
        uniqueCommentors.add(login);
        yield login;
      }
    }

    // update the persistent cache, so that next calls to getIssueCommentors
    // start search from last comment timestamp using the `since` search param
    const lastComment = comments[comments.length - 1] as Comment;
    lastCommentURL.searchParams.set('since', lastComment.created_at);
    persistantCache.set(cacheKey, {
      endpoint: lastCommentURL.href,
      commentors: [...uniqueCommentors],
    });
  }

  cache.set(cacheKey, [...uniqueCommentors]);
  await persistantCache.dump();
}
