// src/routes/paddle.js - Complete Paddle Billing Integration
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Pool } = require('pg');
const { setPortalTier } = require('../services/tierService');

let pool = null;

function getPool() {
  if (!pool && process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

// Paddle Price IDs (you'll get these after creating products)
const PRICE_IDS = {
  starter: process.env.PADDLE_STARTER_PRICE_ID || 'pri_starter',
  pro: process.env.PADDLE_PRO_PRICE_ID || 'pri_pro',
  business: process.env.PADDLE_BUSINESS_PRICE_ID || 'pri_business'
};

// POST /api/paddle/create-checkout - Create Paddle checkout session
router.post('/create-checkout', async (req, res) => {
  const { email, plan, portalId } = req.body;

  if (!email || !plan || !portalId) {
    return res.status(400).json({ error: 'Email, plan, and portalId required' });
  }

  if (!PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  try {
    const priceId = PRICE_IDS[plan];

    // Create checkout session via Paddle API
    const response = await fetch('https://api.paddle.com/checkout-sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: [
          {
            price_id: priceId,
            quantity: 1
          }
        ],
        customer_email: email,
        custom_data: {
          portal_id: portalId,
          plan_tier: plan
        },
        success_url: `${process.env.APP_BASE_URL || 'https://syncstation.app'}/payment-success?session_id={checkout_session_id}`,
        cancel_url: `${process.env.APP_BASE_URL || 'https://syncstation.app'}/settings?portalId=${portalId}`
      })
    });

    const data = await response.json();

    if (data.data && data.data.url) {
      res.json({
        success: true,
        checkout_url: data.data.url,
        session_id: data.data.id
      });
    } else {
      console.error('[Paddle] Checkout creation error:', data);
      res.status(400).json({ 
        error: data.error?.detail || 'Failed to create checkout session' 
      });
    }

  } catch (err) {
    console.error('[Paddle] Create checkout error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/paddle/session/:sessionId - Get checkout session details
router.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`https://api.paddle.com/checkout-sessions/${sessionId}`, {
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`
      }
    });

    const data = await response.json();

    if (data.data) {
      const session = data.data;
      const customData = session.custom_data || {};
      
      res.json({
        success: true,
        status: session.status,
        customer_email: session.customer_email,
        portal_id: customData.portal_id,
        plan_tier: customData.plan_tier,
        amount: session.details?.totals?.total,
        currency: session.currency_code
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }

  } catch (err) {
    console.error('[Paddle] Get session error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/paddle/webhook - Handle Paddle webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify webhook signature
  const signature = req.headers['paddle-signature'];
  
  if (!signature) {
    console.log('[Paddle] No signature header');
    return res.sendStatus(401);
  }

  try {
    // Parse signature header
    const sigParts = signature.split(';');
    const timestamp = sigParts.find(p => p.startsWith('ts=')).split('=')[1];
    const h1 = sigParts.find(p => p.startsWith('h1=')).split('=')[1];

    // Verify signature
    const signedPayload = timestamp + ':' + req.body.toString();
    const expectedSignature = crypto
      .createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');

    if (expectedSignature !== h1) {
      console.log('[Paddle] Invalid signature');
      return res.sendStatus(401);
    }

    // Parse event
    const event = JSON.parse(req.body.toString());
    console.log('[Paddle] Webhook event:', event.event_type);

    const eventData = event.data;
    const customData = eventData.custom_data || {};
    const portalId = customData.portal_id;

    switch (event.event_type) {
      case 'transaction.completed':
        // Payment successful - activate subscription
        if (portalId && customData.plan_tier) {
          await setPortalTier(portalId, customData.plan_tier);
          
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_customer_id = $1,
                  paddle_subscription_id = $2,
                  paddle_subscription_status = 'active',
                  updated_at = NOW()
              WHERE portal_id = $3
            `, [
              eventData.customer_id,
              eventData.subscription_id || null,
              portalId
            ]);
          }
          
          console.log(`[Paddle] ✅ Portal ${portalId} upgraded to ${customData.plan_tier}`);
        }
        break;

      case 'subscription.activated':
        // Subscription activated
        if (portalId) {
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_subscription_status = 'active'
              WHERE portal_id = $1
            `, [portalId]);
          }
          console.log(`[Paddle] Subscription activated for portal ${portalId}`);
        }
        break;

      case 'subscription.canceled':
        // Subscription cancelled
        if (eventData.custom_data?.portal_id) {
          const portalId = eventData.custom_data.portal_id;
          await setPortalTier(portalId, 'cancelled');
          
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_subscription_status = 'canceled'
              WHERE portal_id = $1
            `, [portalId]);
          }
          console.log(`[Paddle] Portal ${portalId} subscription cancelled`);
        }
        break;

      case 'subscription.past_due':
        // Payment failed - suspend account
        if (eventData.custom_data?.portal_id) {
          const portalId = eventData.custom_data.portal_id;
          await setPortalTier(portalId, 'suspended');
          
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_subscription_status = 'past_due'
              WHERE portal_id = $1
            `, [portalId]);
          }
          console.log(`[Paddle] Portal ${portalId} suspended (payment failed)`);
        }
        break;

      case 'subscription.paused':
        // Subscription paused
        if (eventData.custom_data?.portal_id) {
          const portalId = eventData.custom_data.portal_id;
          await setPortalTier(portalId, 'suspended');
          
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_subscription_status = 'paused'
              WHERE portal_id = $1
            `, [portalId]);
          }
          console.log(`[Paddle] Portal ${portalId} subscription paused`);
        }
        break;

      case 'subscription.resumed':
        // Subscription resumed - reactivate
        if (eventData.custom_data?.portal_id && eventData.custom_data?.plan_tier) {
          const portalId = eventData.custom_data.portal_id;
          await setPortalTier(portalId, eventData.custom_data.plan_tier);
          
          const p = getPool();
          if (p) {
            await p.query(`
              UPDATE portal_tiers 
              SET paddle_subscription_status = 'active'
              WHERE portal_id = $1
            `, [portalId]);
          }
          console.log(`[Paddle] Portal ${portalId} subscription resumed`);
        }
        break;

      default:
        console.log('[Paddle] Unhandled event:', event.event_type);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error('[Paddle] Webhook error:', err.message);
    res.sendStatus(500);
  }
});

// GET /api/paddle/subscription/:portalId - Get subscription status
router.get('/subscription/:portalId', async (req, res) => {
  const { portalId } = req.params;
  const p = getPool();

  if (!p) {
    return res.json({ subscription: null });
  }

  try {
    const result = await p.query(
      'SELECT paddle_subscription_id, paddle_subscription_status FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );

    if (result.rows.length > 0 && result.rows[0].paddle_subscription_id) {
      res.json({
        subscription_id: result.rows[0].paddle_subscription_id,
        status: result.rows[0].paddle_subscription_status || 'unknown'
      });
    } else {
      res.json({ subscription: null });
    }
  } catch (err) {
    console.error('[Paddle] Get subscription error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/paddle/cancel/:portalId - Cancel subscription
router.post('/cancel/:portalId', async (req, res) => {
  const { portalId } = req.params;
  const p = getPool();

  if (!p) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    // Get subscription ID
    const result = await p.query(
      'SELECT paddle_subscription_id FROM portal_tiers WHERE portal_id = $1',
      [portalId]
    );

    if (result.rows.length === 0 || !result.rows[0].paddle_subscription_id) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const subscriptionId = result.rows[0].paddle_subscription_id;

    // Cancel via Paddle API
    const response = await fetch(`https://api.paddle.com/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        effective_from: 'next_billing_period' // or 'immediately'
      })
    });

    const data = await response.json();

    if (data.data) {
      // Update local status
      await setPortalTier(portalId, 'cancelled');
      await p.query(`
        UPDATE portal_tiers 
        SET paddle_subscription_status = 'canceled'
        WHERE portal_id = $1
      `, [portalId]);

      res.json({ success: true, message: 'Subscription will be cancelled at end of billing period' });
    } else {
      res.status(400).json({ error: data.error?.detail || 'Cancellation failed' });
    }

  } catch (err) {
    console.error('[Paddle] Cancel subscription error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
