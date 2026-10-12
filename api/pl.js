// Vercel serverless function: proxies /api/pl/* to the Premier League data API.
import { vercelHandler } from '../lib/upstream.js';

export default vercelHandler('pl');
