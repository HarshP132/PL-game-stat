// Vercel serverless function: proxies /api/espn/* to ESPN's Premier League feed.
import { vercelHandler } from '../lib/upstream.js';

export default vercelHandler('espn');
