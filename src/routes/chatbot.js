// src/routes/chatbot.js - Claude-powered support chatbot
const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { getPortalTier } = require('../services/tierService');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    // Create chat history table
    pool.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        portal_id TEXT,
        session_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).catch(err => console.error('[Chatbot] Table error:', err.message));
  }
  return pool;
}

// SyncStation Knowledge Base
const KNOWLEDGE_BASE = `
# SyncStation Knowledge Base

## What is SyncStation?
SyncStation is a HubSpot integration that automatically syncs property values between associated CRM objects across multiple HubSpot portals. Perfect for agencies, franchises, and holding companies managing multiple HubSpot accounts.

## Core Features
- **Sync Rules**: Automatically sync property values between portals when objects are associated
- **Property Mappings**: Map properties between source and target portals (e.g., Contact.Email → Company.Primary_Email)
- **Bidirectional Sync**: Data syncs both ways when objects are associated
- **Real-time Sync**: Webhook-based sync for standard objects (15-minute intervals for custom objects)
- **Field Type Compatibility**: Smart mapping between different field types
- **Multiple Objects**: Supports Contacts, Companies, Deals, Tickets, Leads, Projects, and custom objects

## Pricing & Tiers

### Trial (14 days)
- 30 property mappings
- All objects available
- Full feature access
- No payment required

### Starter - $10/month
- 20 property mappings
- Objects: Contacts, Companies, Deals
- Real-time webhook sync
- 15-min API sync for custom objects

### Pro - $15/month ⭐ POPULAR
- 30 property mappings
- All objects (Contacts, Companies, Deals, Tickets, Leads, Projects)
- Real-time webhook sync
- 15-min API sync for custom objects

### Business - $40/month
- 100 property mappings
- All objects
- Real-time webhook sync
- 15-min API sync
- Priority support

## How to Create a Sync Rule

1. Go to Settings page for your portal
2. Click "Create New Sync Rule" (currently done by creating mappings)
3. Select source object (e.g., Contact)
4. Select target object (e.g., Company)
5. Choose association type (e.g., "Contact to Company")
6. Add property mappings:
   - Select source property
   - Select target property
   - System validates field type compatibility
7. Save the rule
8. Rule activates automatically

## Property Mappings
- Each tier has a mapping limit (Starter: 20, Pro: 30, Business: 100)
- Mappings are the individual property-to-property connections
- Example: Contact.Email → Company.Primary_Email counts as 1 mapping
- You can have multiple mappings in one sync rule

## Sync Process
1. When objects are associated in source portal (e.g., Contact linked to Company)
2. SyncStation receives webhook notification
3. Checks for active sync rules matching those objects
4. Applies property mappings
5. Updates properties in target portal
6. Logs success or error

## Common Issues

### "My sync rule isn't working"
- Check if rule is enabled (toggle on settings page)
- Verify objects are actually associated in HubSpot
- Check sync error log for specific errors
- Ensure you haven't hit your mapping limit

### "I'm hitting my mapping limit"
- Starter: 20 mappings max
- Pro: 30 mappings max
- Business: 100 mappings max
- Upgrade your plan to add more mappings

### "Trial expired"
- Free trial lasts 14 days
- After trial, upgrade to Starter, Pro, or Business
- Your sync rules are saved but inactive until you upgrade

### "Sync errors appearing"
- View errors on Settings page (click Sync Errors stat)
- Common causes:
  - Permission issues in HubSpot
  - Invalid property values
  - Missing required fields
  - API rate limits
- Clear errors after fixing issues

## OAuth & Connections
- SyncStation uses OAuth to connect to HubSpot
- Tokens refresh automatically
- If "Unauthorized" error appears, reconnect your HubSpot account
- Go to Settings → Reconnect

## Upgrading Plans
- Click "Upgrade" on Settings or Account page
- Choose your plan (Starter/Pro/Business)
- Complete payment via Paddle
- Tier updates immediately
- New limits apply right away

## Support
- Email: support@syncstation.app (if they ask for email)
- Documentation: Available in app
- Response time: Usually within 24 hours

## Technical Details
- Webhook sync: Near real-time for standard objects
- API sync: 15-minute intervals for custom objects
- Supported objects: Contacts, Companies, Deals, Tickets, Leads, Projects, and custom objects
- Field types: Text, Number, Date, Boolean, Dropdown, Multi-select (with compatibility rules)
`;

// POST /api/chatbot/message - Send message to chatbot
router.post('/message', async (req, res) => {
  const { message, sessionId, portalId } = req.body;

  console.log('[Chatbot] 🔵 Request received:', { message, sessionId, portalId });

  if (!message || !sessionId) {
    console.log('[Chatbot] ❌ Missing required fields');
    return res.status(400).json({ error: 'Message and sessionId required' });
  }

  // Check API key immediately
  if (!process.env.CLAUDE_API_KEY) {
    console.error('[Chatbot] ❌ CRITICAL: CLAUDE_API_KEY is not set!');
    return res.status(500).json({ error: 'Chatbot configuration error' });
  }

  console.log('[Chatbot] ✅ API key present:', process.env.CLAUDE_API_KEY.substring(0, 20) + '...');

  try {
    const p = getPool();
    
    // Get user context if portalId provided
    let userContext = '';
    if (portalId) {
      console.log('[Chatbot] Fetching user context for portal:', portalId);
      try {
        const tierInfo = await getPortalTier(portalId);
        const tierData = tierInfo || { tier: 'unknown' };
        
        userContext = `\nUSER CONTEXT:
Portal ID: ${portalId}
Current Tier: ${tierData.tier || 'unknown'}
Mapping Limit: ${tierData.maxMappings || 'unknown'}
`;
        
        // Get sync rule count if possible
        if (p) {
          const rulesResult = await p.query(
            'SELECT rules FROM sync_rules WHERE portal_id = $1',
            [portalId]
          );
          if (rulesResult.rows.length > 0) {
            const rules = rulesResult.rows[0].rules || [];
            const mappingCount = rules.reduce((sum, r) => sum + (r.mappings?.length || 0), 0);
            userContext += `Current Mappings Used: ${mappingCount}\n`;
          }
        }
        console.log('[Chatbot] User context loaded');
      } catch (err) {
        console.log('[Chatbot] Could not fetch user context:', err.message);
      }
    }

    // Get conversation history for context
    let conversationHistory = [];
    if (p) {
      try {
        const historyResult = await p.query(
          `SELECT message_type, content FROM chat_history 
           WHERE session_id = $1 
           ORDER BY created_at DESC 
           LIMIT 10`,
          [sessionId]
        );
        conversationHistory = historyResult.rows.reverse();
        console.log('[Chatbot] Loaded', conversationHistory.length, 'history messages');
      } catch (err) {
        console.log('[Chatbot] Could not fetch history:', err.message);
      }
    }

    // Build conversation for Claude
    const messages = [];
    
    // Add history
    conversationHistory.forEach(msg => {
      messages.push({
        role: msg.message_type === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    });
    
    // Add current message
    messages.push({
      role: 'user',
      content: message
    });

    console.log('[Chatbot] 🚀 Calling Claude API...');
    console.log('[Chatbot] Messages count:', messages.length);

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: `You are a helpful support agent for SyncStation, a HubSpot multi-portal sync application.

Your role:
- Answer questions about SyncStation features, pricing, and usage
- Help users troubleshoot sync issues
- Explain how to create sync rules and mappings
- Be friendly, concise, and helpful
- If you don't know something, admit it and offer to connect them with human support

Knowledge Base:
${KNOWLEDGE_BASE}
${userContext}

Guidelines:
- Keep responses concise (2-3 paragraphs max)
- Use bullet points for lists
- Provide specific examples when helpful
- Link to Settings page when relevant: /settings?portalId={portalId}
- Link to Account page for upgrades: /account?portalId={portalId}
- If question is too complex or you're unsure, offer to escalate to email support
- Be warm and professional
- Don't make up information not in the knowledge base`,
        messages: messages
      })
    });

    console.log('[Chatbot] API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Chatbot] ❌ API error response:', errorText);
      throw new Error(`Claude API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('[Chatbot] ✅ API response received');

    if (data.content && data.content[0]) {
      const botResponse = data.content[0].text;
      console.log('[Chatbot] Response length:', botResponse.length, 'characters');

      // Store conversation history
      if (p) {
        try {
          await p.query(
            `INSERT INTO chat_history (portal_id, session_id, message_type, content) 
             VALUES ($1, $2, $3, $4)`,
            [portalId || null, sessionId, 'user', message]
          );
          await p.query(
            `INSERT INTO chat_history (portal_id, session_id, message_type, content) 
             VALUES ($1, $2, $3, $4)`,
            [portalId || null, sessionId, 'assistant', botResponse]
          );
          console.log('[Chatbot] Conversation saved to history');
        } catch (err) {
          console.log('[Chatbot] Could not store history:', err.message);
        }
      }

      res.json({
        response: botResponse,
        sessionId: sessionId
      });
    } else {
      console.error('[Chatbot] ❌ Unexpected API response format:', data);
      res.status(500).json({ error: 'Failed to get response from chatbot' });
    }

  } catch (err) {
    console.error('[Chatbot] ❌ Error:', err.message);
    console.error('[Chatbot] ❌ Full error:', err);
    console.error('[Chatbot] ❌ Stack:', err.stack);
    res.status(500).json({ error: 'Chatbot error' });
  }
});

// GET /api/chatbot/history/:sessionId - Get chat history
router.get('/history/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const p = getPool();

  if (!p) {
    return res.json({ messages: [] });
  }

  try {
    const result = await p.query(
      `SELECT message_type, content, created_at 
       FROM chat_history 
       WHERE session_id = $1 
       ORDER BY created_at ASC`,
      [sessionId]
    );

    res.json({
      messages: result.rows.map(row => ({
        type: row.message_type,
        content: row.content,
        timestamp: row.created_at
      }))
    });
  } catch (err) {
    console.error('[Chatbot] Get history error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
