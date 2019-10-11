import { requestData } from './utils/graphql.js';

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

/**
 * Get commits since (inclusive) given commitish
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
  const since = await getSinceDate(org, repo, ref);
  let cursor: string | undefined;
  do {
    const data = await getCommitsSince(org, repo, since, cursor);
    yield* data.commits;
    cursor = data.cursor;
  } while (!!cursor);
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
    throw new Error('Cannot query `since` date using given org/repo@ref');
  }
  return repository.object.history.nodes[0].committedDate;
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
  const { nodes, pageInfo } = repository.object.history;
  return {
    commits: nodes,
    cursor: pageInfo.hasNextPage ? pageInfo.endCursor : undefined,
  };
}
