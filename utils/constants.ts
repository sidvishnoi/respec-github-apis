if (!process.env.GH_TOKEN) {
  throw new Error('GH_TOKEN env variable must be set');
}

export const TOKENS: Readonly<string[]> = [process.env.GH_TOKEN];

if (!process.env.DATA_DIR) {
  throw new Error('DATA_DIR env variable must be set');
}

export const DATA_DIR = process.env.DATA_DIR;
