import { requestData } from './utils/graphql.js';
import { TTLCache } from './utils/cache.js';

interface User {
  name: string;
  login: string;
}

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
export const cache = new TTLCache<string, User>(CACHE_TTL);

/**
 * Gets user details (name in particular) for each given logins
 * @param logins user login names
 */
export async function getUsersDetails(logins: string[]) {
  const results: { [login: string]: User } = Object.create(null);

  for (const login of logins) {
    const cached = cache.get(login);
    if (cached !== null) {
      results[login] = cached;
    }
  }

  const loginsToFetch = logins.filter(login => !cache.get(login));
  if (!loginsToFetch.length) {
    return results;
  }

  const query = createQuery(loginsToFetch);
  const data: { [login: string]: User } = await requestData(query);
  for (const user of Object.values(data)) {
    if (!user) continue;
    results[user.login] = user;
    cache.set(user.login, user);
  }

  return results;
}

function createQuery(logins: string[]) {
  // sending special characters in GraphQL query alias isn't allowed
  const alias = (str: string) => str.replace(/[^\w]/g, '_');
  const subQueries = logins.map(
    login => `${alias(login)}: user(login: "${login}") { ...user }`,
  );
  return `
    query {
      ${subQueries.join('\n')}
    }
    fragment user on User {
      name
      login
    }`;
}
