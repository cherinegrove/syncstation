const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { setPortalTier } = require('../services/tierService');

// PayStack webhook endpoint
router.post('/webhook', async (req, res) => {
  try {
    // Verify PayStack signature
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      console.log('Invalid PayStack signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { event, data } = req.body;
    console.log(`PayStack webhook received: ${event}`);

    // Handle subscription created
    if (event === 'subscription.create') {
      const { customer, plan, subscription_code, status } = data;
      
      // Find portal by PayStack customer ID
      const portal = await db.query(
        'SELECT portal_id FROM portal_tiers WHERE paystack_customer_id = $1',
        [customer.customer_code]
      );

      if (portal.rows.length > 0) {
        const portalId = portal.rows[0].portal_id;
        
        // Map PayStack plan to tier
        let tier = 'trial';
        if (plan.plan_code === process.env.PAYSTACK_PLAN_STARTER) {
          tier = 'starter';
        } else if (plan.plan_code === process.env.PAYSTACK_PLAN_PRO) {
          tier = 'pro';
        } else if (plan.plan_code === process.env.PAYSTACK_PLAN_BUSINESS) {
          tier = 'business';
        }

        // Update portal with subscription details
        await db.query(
          `UPDATE portal_tiers 
           SET tier = $1, 
               paystack_subscription_id = $2, 
               paystack_subscription_status = $3
           WHERE portal_id = $4`,
          [tier, subscription_code, status, portalId]
        );

        console.log(`Upgraded portal ${portalId} to ${tier} tier`);
      }
    }

    // Handle subscription disabled/cancelled
    if (event === 'subscription.disable') {
      const { subscription_code } = data;
      
      const portal = await db.query(
        'SELECT portal_id FROM portal_tiers WHERE paystack_subscription_id = $1',
        [subscription_code]
      );

      if (portal.rows.length > 0) {
        const portalId = portal.rows[0].portal_id;
        
        // Downgrade to FREE tier (not trial)
        await db.query(
          `UPDATE portal_tiers 
           SET tier = 'free', 
               paystack_subscription_status = 'cancelled'
           WHERE portal_id = $1`,
          [portalId]
        );

        console.log(`Downgraded portal ${portalId} to FREE tier after cancellation`);
      }
    }

    // Handle successful charge
    if (event === 'charge.success') {
      const { customer, metadata } = data;
      
      if (metadata && metadata.subscription_code) {
        await db.query(
          `UPDATE portal_tiers 
           SET paystack_subscription_status = 'active'
           WHERE paystack_subscription_id = $1`,
          [metadata.subscription_code]
        );

        console.log(`Marked subscription ${metadata.subscription_code} as active`);
      }
    }

    // Handle failed charge
    if (event === 'charge.failed') {
      const { customer, metadata } = data;
      
      if (metadata && metadata.subscription_code) {
        await db.query(
          `UPDATE portal_tiers 
           SET paystack_subscription_status = 'past_due'
           WHERE paystack_subscription_id = $1`,
          [metadata.subscription_code]
        );

        console.log(`Marked subscription ${metadata.subscription_code} as past_due`);
      }
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('PayStack webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Create PayStack customer and return checkout URL
router.post('/create-subscription', async (req, res) => {
  try {
    const { portalId, email, plan } = req.body;

    if (!portalId || !email || !plan) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate plan
    const validPlans = ['starter', 'pro', 'business'];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Get PayStack plan code from environment
    const planMap = {
      starter: process.env.PAYSTACK_PLAN_STARTER,
      pro: process.env.PAYSTACK_PLAN_PRO,
      business: process.env.PAYSTACK_PLAN_BUSINESS
    };

    const paystackPlanCode = planMap[plan];
    if (!paystackPlanCode) {
      return res.status(500).json({ error: 'Plan not configured in environment' });
    }

    // Initialize PayStack transaction
    const fetch = (await import('node-fetch')).default;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: getPlanAmount(plan), // in kobo (cents)
        plan: paystackPlanCode,
        callback_url: `${process.env.APP_URL || 'https://propbridge-production.up.railway.app'}/settings?portal_id=${portalId}`,
        metadata: {
          portal_id: portalId,
          plan: plan
        }
      })
    });

    const data = await response.json();

    if (data.status) {
      // Store customer reference
      await db.query(
        `UPDATE portal_tiers 
         SET paystack_customer_id = $1
         WHERE portal_id = $2`,
        [data.data.reference, portalId]
      );

      res.json({
        success: true,
        checkout_url: data.data.authorization_url,
        reference: data.data.reference
      });
    } else {
      res.status(500).json({ error: data.message });
    }

  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Helper function to get plan amounts (in kobo - PayStack uses smallest currency unit)
function getPlanAmount(plan) {
  const amounts = {
    starter: 29900, // R299.00 = 29900 kobo
    pro: 79900,     // R799.00 = 79900 kobo  
    business: 199900 // R1999.00 = 199900 kobo
  };
  return amounts[plan] || 0;
}

module.exports = router;
