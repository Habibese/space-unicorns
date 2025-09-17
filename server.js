require('dotenv').config();
const express = require('express');
const path = require('path');
const UnicornDatabase = require('./database.js');
const { v4: uuidv4 } = require('uuid');

// Check if Stripe keys are configured
if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.includes('51234567890abcdef')) {
    console.log('⚠️  WARNING: Please configure your Stripe keys in the .env file');
    console.log('📝 Edit .env and replace the placeholder keys with your actual Stripe keys');
    console.log('🔗 Get your keys from: https://dashboard.stripe.com/apikeys');
}

const stripe = process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('51234567890abcdef') 
    ? require('stripe')(process.env.STRIPE_SECRET_KEY)
    : null;

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new UnicornDatabase();

// Position generation for database (server-side)
function generateDatabasePosition(unicornCount) {
    const baseRadius = 20;
    const expansionFactor = Math.pow(unicornCount + 1, 1/3);
    const maxRadius = baseRadius + (expansionFactor * 15);
    
    const radius = baseRadius + Math.random() * maxRadius;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    
    return {
        x: radius * Math.sin(phi) * Math.cos(theta),
        y: radius * Math.cos(phi) + Math.random() * 50 - 25,
        z: radius * Math.sin(phi) * Math.sin(theta)
    };
}

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Serve the main HTML file
app.get('/', (req, res) => {
    // Check if Stripe is configured
    if (!process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY.includes('51234567890abcdef')) {
        res.sendFile(path.join(__dirname, 'setup-instructions.html'));
    } else {
        res.sendFile(path.join(__dirname, 'unicorn-shop-simple.html'));
    }
});

// Get Stripe publishable key
app.get('/config', (req, res) => {
    res.send({
        publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
        unicorn_price: parseInt(process.env.UNICORN_PRICE) || 25,
        currency: process.env.CURRENCY || 'usd'
    });
});

// Get all unicorns from database
app.get('/unicorns', async (req, res) => {
    try {
        const unicorns = await db.getAllUnicorns();
        res.json(unicorns);
    } catch (error) {
        console.error('❌ Error fetching unicorns:', error);
        res.status(500).json({ error: 'Failed to fetch unicorns' });
    }
});

// Get unicorns by session
app.get('/unicorns/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const unicorns = await db.getUnicornsBySession(sessionId);
        res.json(unicorns);
    } catch (error) {
        console.error('❌ Error fetching user unicorns:', error);
        res.status(500).json({ error: 'Failed to fetch user unicorns' });
    }
});

// Get statistics
app.get('/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Create payment intent
app.post('/create-payment-intent', async (req, res) => {
    if (!stripe) {
        return res.status(500).json({
            error: 'Stripe not configured. Please add your Stripe keys to the .env file.'
        });
    }
    
    try {
        const { base_name, unicorn_orders, total_unicorns, total_amount, user_session } = req.body;
        const currency = process.env.CURRENCY || 'usd';
        
        // Validate the total amount server-side
        const expectedAmount = total_unicorns * (parseInt(process.env.UNICORN_PRICE) || 25);
        if (total_amount !== expectedAmount) {
            return res.status(400).json({
                error: 'Invalid amount calculation'
            });
        }
        
        // Create a PaymentIntent with the order amount and currency
        const paymentIntent = await stripe.paymentIntents.create({
            amount: total_amount, // Total amount in cents
            currency: currency,
            metadata: {
                base_name: base_name,
                total_unicorns: total_unicorns.toString(),
                unicorn_orders: JSON.stringify(unicorn_orders),
                user_session: user_session,
                product: 'space_unicorns'
            },
            automatic_payment_methods: {
                enabled: true,
            },
        });
        
        // Save payment to database
        await db.savePayment({
            paymentIntentId: paymentIntent.id,
            baseName: base_name,
            totalUnicorns: total_unicorns,
            totalAmount: total_amount,
            currency: currency,
            status: 'pending',
            unicornOrders: unicorn_orders,
            userSession: user_session
        });

        console.log(`Payment Intent created: ${paymentIntent.id}`);
        console.log(`  Base name: ${base_name}`);
        console.log(`  Total unicorns: ${total_unicorns}`);
        console.log(`  Total amount: $${(total_amount / 100).toFixed(2)}`);
        console.log(`  Orders: ${JSON.stringify(unicorn_orders)}`);
        console.log(`  User session: ${user_session}`);
        
        res.send({
            client_secret: paymentIntent.client_secret,
            session_id: user_session
        });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).send({
            error: error.message
        });
    }
});

// Webhook endpoint for Stripe events
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    // Verify webhook signature
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        console.log(`✅ Webhook signature verified for event: ${event.type}`);
    } catch (err) {
        console.log(`❌ Webhook signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle different event types
    switch (event.type) {
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            const baseName = paymentIntent.metadata.base_name;
            const totalUnicorns = parseInt(paymentIntent.metadata.total_unicorns);
            const unicornOrders = JSON.parse(paymentIntent.metadata.unicorn_orders || '[]');
            const amount = paymentIntent.amount;
            
            console.log(`🦄✅ PAYMENT SUCCESS!`);
            console.log(`   Base name: ${baseName}`);
            console.log(`   Total unicorns: ${totalUnicorns}`);
            console.log(`   Amount: $${(amount / 100).toFixed(2)}`);
            console.log(`   Orders: ${JSON.stringify(unicornOrders)}`);
            console.log(`   Payment ID: ${paymentIntent.id}`);
            
            try {
                // Update payment status
                await db.updatePaymentStatus(paymentIntent.id, 'succeeded', new Date().toISOString());
                
                // Create and save unicorns to database
                const colorMap = ['Pink', 'Cyan', 'Magenta', 'Yellow', 'Green', 'Orange', 'Purple', 'Deep Pink', 'Sky Blue', 'Lime', 'Gold', 'Tomato'];
                const colorHexMap = ['#ff69b4', '#00ffff', '#ff00ff', '#ffff00', '#00ff00', '#ff4500', '#8a2be2', '#ff1493', '#00bfff', '#32cd32', '#ffd700', '#ff6347'];
                
                // Get existing unicorn count for position generation
                const existingUnicorns = await db.getAllUnicorns();
                let unicornCounter = existingUnicorns.length;
                
                for (const order of unicornOrders) {
                    const colorIndex = colorMap.indexOf(order.color);
                    const colorHex = colorHexMap[colorIndex];
                    
                    for (let i = 0; i < order.quantity; i++) {
                        // Generate unique position for each unicorn
                        const position = generateDatabasePosition(unicornCounter);
                        const unicornName = order.quantity > 1 ? `${baseName} ${i + 1}` : baseName;
                        
                        await db.saveUnicorn({
                            name: unicornName,
                            colorName: order.color,
                            colorHex: colorHex,
                            position: position,
                            initialRotation: Math.random() * Math.PI * 2,
                            paymentIntentId: paymentIntent.id,
                            userSession: paymentIntent.metadata.user_session || 'unknown'
                        });
                        
                        unicornCounter++;
                    }
                }
                
                console.log(`✅ ${totalUnicorns} unicorns saved to database`);
                
                // Save space statistics
                const stats = await db.getStats();
                const spaceRadius = 20 + Math.pow(stats.total_unicorns, 1/3) * 15;
                await db.saveSpaceStats(stats.total_unicorns, stats.total_revenue, spaceRadius);
                
            } catch (dbError) {
                console.error('❌ Database error during payment processing:', dbError);
            }
            
            break;
            
        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            const failedBaseName = failedPayment.metadata.base_name;
            const failedTotal = failedPayment.metadata.total_unicorns;
            
            console.log(`🦄❌ PAYMENT FAILED!`);
            console.log(`   Base name: ${failedBaseName}`);
            console.log(`   Total unicorns: ${failedTotal}`);
            console.log(`   Payment ID: ${failedPayment.id}`);
            console.log(`   Error: ${failedPayment.last_payment_error?.message || 'Unknown error'}`);
            
            // 🔥 HANDLE FAILURE:
            // - Log error details
            // - Notify user of failure
            // - Implement retry logic
            
            break;
            
        case 'payment_intent.canceled':
            const canceledPayment = event.data.object;
            const canceledBaseName = canceledPayment.metadata.base_name;
            const canceledTotal = canceledPayment.metadata.total_unicorns;
            
            console.log(`🦄🔄 PAYMENT CANCELED!`);
            console.log(`   Base name: ${canceledBaseName}`);
            console.log(`   Total unicorns: ${canceledTotal}`);
            console.log(`   Payment ID: ${canceledPayment.id}`);
            
            break;
            
        case 'payment_intent.created':
            const createdPayment = event.data.object;
            console.log(`🦄🆕 Payment intent created: ${createdPayment.id}`);
            break;
            
        default:
            console.log(`🤷 Unhandled event type: ${event.type}`);
    }
    
    // Always respond with 200 to acknowledge receipt
    res.json({
        received: true,
        event_type: event.type,
        event_id: event.id
    });
});

app.listen(PORT, () => {
    console.log(`🦄 Space Unicorns Server running on port ${PORT}`);
    console.log(`🌐 Open http://localhost:${PORT} to start buying unicorns!`);
});
