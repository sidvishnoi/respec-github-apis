import { requestData } from './utils/graphql.js';
import { TTLCache } from './utils/cache.js';

export interface Commit {
  messageHeadline: string;
  abbreviatedOid: string;
  committedDate: string;
  author: { user: { login: string; name: string } };
}

interface HistoryResponse {
  repository: {
    object: {
      history: {
        nodes: Commit[];
        pageInfo: {
          endCursor: string;
          hasNextPage: boolean;
        };
      };
    };
  };
}

interface CacheEntry {
  commits: Commit[];
  since: string;
}
// Stale data is not written to file on dump().
// This prevents cache file getting too large (on disk as well as memory)
const TTL = 15 * 24 * 60 * 60 * 1000; // 15 days
const _persistentCachePromise = new TTLCache<string, CacheEntry>(
  TTL,
  undefined,
  'gh/commits',
).load();

/**
 * Get commits since given commitish
 * @param org repository owner/organization
 * @param repo repository name
 * @param ref commitish
 * @example
 * ```
 * for await (const commit of getCommits('w3c', 'respec', 'HEAD~5')) {
 *   console.log(commit);
 * }
 * ```
 */
export async function* getCommits(org: string, repo: string, ref: string) {
  const cache = await _persistentCachePromise;

  const cacheKey = `${org}/${repo}@${ref}`;
  const cached = cache.get(cacheKey);

  const { since, commits } = cached || {
    since: await getSinceDate(org, repo, ref),
    commits: [],
  };

  // immediately send out cached items
  yield* commits;

  const newCacheEntry = { since: '', commits };
  let cursor: string | undefined;
  do {
    const data = await getCommitsSince(org, repo, since, cursor);
    yield* data.commits;
    cursor = data.cursor;

    // to update cache
    if (data.commits && data.commits.length) {
      newCacheEntry.commits.push(...data.commits);
      if (newCacheEntry.since === '') {
        const HEAD = data.commits[0];
        newCacheEntry.since = HEAD.committedDate;
      }
    }
  } while (!!cursor);

  const hasNewData = !cached || newCacheEntry.since !== cached.since;
  if (hasNewData && newCacheEntry.since !== '') {
    cache.set(cacheKey, newCacheEntry);
    await cache.dump();
  }
}

async function getSinceDate(org: string, repo: string, ref: string) {
  const query = `
    query($org: String!, $repo: String!, $ref: String!) {
      repository(owner: $org, name: $repo) {
        object(expression: $ref) {
          ... on Commit {
            history(first: 1) {
              nodes {
                committedDate
              }
            }
          }
        }
      }
    }
  `;

  const data = await requestData(query, { org, repo, ref });
  const repository: HistoryResponse['repository'] | null = data.repository;
  if (repository === null) {
    throw new Error('Cannot find given repository');
  }
  try {
    return repository.object.history.nodes[0].committedDate;
  } catch {
    throw new Error('Cannot query `since` date using given ref');
  }
}

async function getCommitsSince(
  org: string,
  repo: string,
  since: string,
  cursor?: string,
) {
  const query = `
    query(
      $org: String!
      $repo: String!
      $since: GitTimestamp!
      $cursor: String
    ) {
      repository(owner: $org, name: $repo) {
        object(expression: "HEAD") {
          ... on Commit {
            history(since: $since, after: $cursor) {
              nodes {
                messageHeadline
                abbreviatedOid
                committedDate
                author {
                  user {
                    login
                    name
                  }
                }
              }
              pageInfo {
                endCursor
                hasNextPage
              }
            }
          }
        }
      }
    }
  `;

  const data = await requestData(query, { org, repo, since, cursor });

  const { repository }: HistoryResponse = data;
  const { nodes: commits, pageInfo } = repository.object.history;
  // skip the commit referencing "ref" (on last page)
  if (!pageInfo.hasNextPage) commits.pop();
  return {
    commits,
    cursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
  };
}
