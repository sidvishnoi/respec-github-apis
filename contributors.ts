import { requestData } from './utils/rest.js';
import { TTLCache } from './utils/cache.js';

interface Contributor {
  [key: string]: any;
  login: string;
  contributions: number;
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export const cache = new TTLCache<string, Contributor[]>(CACHE_TTL);

const getAPIURL = (owner: string, repo: string) =>
  new URL(`https://api.github.com/repos/${owner}/${repo}/contributors`).href;

/**
 * Gets GitHub login names and number of contributions of all the contributors
 * to a particular repo
 * @param owner organisation/user, e.g. `"w3c"`
 * @param repo repository name, e.g. `"payment-request"`
 */
export async function* getContributors(owner: string, repo: string) {
  const cacheKey = `${owner}-${repo}`;
  const resultFromCache = cache.get(cacheKey);
  if (resultFromCache !== null) {
    yield* resultFromCache;
    return;
  }

  const allContributers: Contributor[] = [];
  const endpoint = getAPIURL(owner, repo);
  for await (const { result: contributors } of requestData(endpoint)) {
    for (const { login, contributions } of contributors as Contributor[]) {
      const contributor = { login, contributions };
      yield contributor;
      allContributers.push(contributor);
    }
  }

  cache.set(cacheKey, allContributers);
}
