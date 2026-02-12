require('dotenv').config();
const Parser = require('rss-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const parser = new Parser();

// --- CONFIGURATION ---
const RSS_FEEDS = [
  "https://www.google.com/alerts/feeds/14115988719291167525/2746694005765036036",
  "https://www.google.com/alerts/feeds/14115988719291167525/9268419172656067202"
];

const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_TO = process.env.TELEGRAM_TO;

// --- LOGIC ---

async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_TO) {
    console.error("Missing TELEGRAM_TOKEN or TELEGRAM_TO");
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_TO,
      text: message,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    });
    console.log("Message sent to Telegram.");
  } catch (error) {
    console.error("Error sending Telegram message:", error.message);
  }
}

function filterItem(item) {
  const title = item.title ? item.title.toLowerCase() : "";
  const content = item.contentSnippet ? item.contentSnippet.toLowerCase() : "";
  const fullText = title + " " + content;

  // 1. FILTRE DE PRÉCISION : Année 2026 obligatoire
  if (!fullText.includes("2026")) return null;

  // 2. MUR DE PROTECTION : Rejet strict des termes indésirables
  const dealBreakers = [
    "technicien", 
    "technicians",
    "commercial", 
    "sales",
    "centre d'appel", 
    "call center", 
    "pfe", 
    "projet de fin d'études"
  ];
  
  if (dealBreakers.some(word => fullText.includes(word))) return null;

  // 3. DÉTECTION DE CIBLES PRIORITAIRES
  const targets = [
    "abb", 
    "ocp", 
    "safran", 
    "stellantis", 
    "renault", 
    "automatisme"
  ];
  const isPriority = targets.some(t => fullText.includes(t));

  return { isPriority };
}

async function main() {
  // Load history
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch (e) {
      console.error("Error reading history file", e);
    }
  }

  let newItemsCount = 0;
  const newHistory = [...history];

  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      console.log(`Checking feed: ${feed.title}`);

      for (const item of feed.items) {
        // Use guid or link as unique ID
        const id = item.guid || item.link;
        if (newHistory.includes(id)) continue;

        const filterResult = filterItem(item);
        if (filterResult) {
            // New valid item found!
            const { isPriority } = filterResult;
            const date = new Date(item.isoDate).toLocaleDateString('fr-FR');
            
            const header = isPriority ? '🚨 *CIBLE PRIORITAIRE DÉTECTÉE*' : '🆕 *Nouvelle Opportunité PFA*';
            const message = `${header}\n\n` +
                            `**Poste:** ${item.title}\n` +
                            `**Date:** ${date}\n\n` +
                            `[Voir l'offre](${item.link})`;

            await sendTelegram(message);
            newItemsCount++;
            newHistory.push(id);
        }
      }
    } catch (error) {
        console.error(`Error fetching feed ${feedUrl}:`, error.message);
    }
  }

  // Save updated history
  // Keep only the last 500 items to avoid infinite growth
  const prunedHistory = newHistory.slice(-500); 
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(prunedHistory, null, 2));
  
  console.log(`Done. Sent ${newItemsCount} new notifications.`);
}

main();
