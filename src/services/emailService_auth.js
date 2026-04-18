// =====================================================
// EMAIL SERVICE - AUTHENTICATION EMAILS
// Sends verification, password reset, and invitation emails
// =====================================================

const nodemailer = require('nodemailer');

class EmailService {
    constructor() {
        // Configure your email transporter
        // Using environment variables for configuration
        this.transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD
            }
        });
        
        this.fromEmail = process.env.FROM_EMAIL || 'noreply@propbridge.io';
        this.fromName = process.env.FROM_NAME || 'PropBridge';
        this.appUrl = process.env.APP_URL || 'https://propbridge-production.up.railway.app';
    }
    
    /**
     * Send email verification
     */
    async sendVerificationEmail(email, fullName, verificationToken) {
        const verificationUrl = `${this.appUrl}/verify-email?token=${verificationToken}`;
        
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: 'Verify Your PropBridge Account',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
                        .content { background: #f9fafb; padding: 30px; }
                        .button { 
                            display: inline-block; 
                            background: #2563eb; 
                            color: white; 
                            padding: 12px 30px; 
                            text-decoration: none; 
                            border-radius: 5px;
                            margin: 20px 0;
                        }
                        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Welcome to PropBridge!</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>
                            <p>Thank you for registering with PropBridge. Please verify your email address to complete your account setup.</p>
                            <p style="text-align: center;">
                                <a href="${verificationUrl}" class="button">Verify Email Address</a>
                            </p>
                            <p>Or copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #2563eb;">${verificationUrl}</p>
                            <p>This link will expire in 24 hours.</p>
                            <p>If you didn't create an account with PropBridge, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} PropBridge. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };
        
        return this.transporter.sendMail(mailOptions);
    }
    
    /**
     * Send password reset email
     */
    async sendPasswordResetEmail(email, fullName, resetToken) {
        const resetUrl = `${this.appUrl}/reset-password?token=${resetToken}`;
        
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: 'Reset Your PropBridge Password',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
                        .content { background: #f9fafb; padding: 30px; }
                        .button { 
                            display: inline-block; 
                            background: #2563eb; 
                            color: white; 
                            padding: 12px 30px; 
                            text-decoration: none; 
                            border-radius: 5px;
                            margin: 20px 0;
                        }
                        .warning { 
                            background: #fef3c7; 
                            border-left: 4px solid #f59e0b; 
                            padding: 15px; 
                            margin: 20px 0; 
                        }
                        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Password Reset Request</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>
                            <p>We received a request to reset your password for your PropBridge account.</p>
                            <p style="text-align: center;">
                                <a href="${resetUrl}" class="button">Reset Password</a>
                            </p>
                            <p>Or copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #2563eb;">${resetUrl}</p>
                            <div class="warning">
                                <strong>⚠️ Security Notice:</strong>
                                <ul style="margin: 10px 0;">
                                    <li>This link expires in 1 hour</li>
                                    <li>If you didn't request this reset, please ignore this email</li>
                                    <li>Your password won't change until you create a new one</li>
                                </ul>
                            </div>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} PropBridge. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };
        
        return this.transporter.sendMail(mailOptions);
    }
    
    /**
     * Send invitation email to new user
     */
    async sendInvitationEmail(email, fullName, inviterName, portalId, tempPassword, verificationToken) {
        const loginUrl = `${this.appUrl}/login?portal=${portalId}`;
        const verificationUrl = `${this.appUrl}/verify-email?token=${verificationToken}`;
        
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: `${inviterName} invited you to join PropBridge`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
                        .content { background: #f9fafb; padding: 30px; }
                        .button { 
                            display: inline-block; 
                            background: #2563eb; 
                            color: white; 
                            padding: 12px 30px; 
                            text-decoration: none; 
                            border-radius: 5px;
                            margin: 20px 0;
                        }
                        .credentials { 
                            background: white; 
                            border: 2px solid #2563eb; 
                            padding: 15px; 
                            margin: 20px 0;
                            border-radius: 5px;
                        }
                        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>You've Been Invited!</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>
                            <p><strong>${inviterName}</strong> has invited you to collaborate on their HubSpot portal using PropBridge.</p>
                            
                            <h3>Your Login Credentials:</h3>
                            <div class="credentials">
                                <p><strong>Email:</strong> ${email}</p>
                                <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
                            </div>
                            
                            <p><strong>Important:</strong> Please change your password after your first login.</p>
                            
                            <h3>Get Started:</h3>
                            <ol>
                                <li>Verify your email address (required first step)</li>
                                <li>Login with your temporary password</li>
                                <li>Update your password in settings</li>
                                <li>Start collaborating!</li>
                            </ol>
                            
                            <p style="text-align: center;">
                                <a href="${verificationUrl}" class="button">Verify Email & Get Started</a>
                            </p>
                            
                            <p>After verification, login here: <a href="${loginUrl}">${loginUrl}</a></p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} PropBridge. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };
        
        return this.transporter.sendMail(mailOptions);
    }
    
    /**
     * Send portal access email to existing user
     */
    async sendPortalAccessEmail(email, fullName, inviterName, portalId, role) {
        const loginUrl = `${this.appUrl}/login?portal=${portalId}`;
        
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: `${inviterName} added you to their PropBridge portal`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
                        .content { background: #f9fafb; padding: 30px; }
                        .button { 
                            display: inline-block; 
                            background: #2563eb; 
                            color: white; 
                            padding: 12px 30px; 
                            text-decoration: none; 
                            border-radius: 5px;
                            margin: 20px 0;
                        }
                        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>New Portal Access!</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>
                            <p>Great news! <strong>${inviterName}</strong> has added you to their HubSpot portal with <strong>${role}</strong> access.</p>
                            <p>You can now access this portal using your existing PropBridge account.</p>
                            <p style="text-align: center;">
                                <a href="${loginUrl}" class="button">Login Now</a>
                            </p>
                            <p>Your new portal will appear in your portal selector after login.</p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} PropBridge. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };
        
        return this.transporter.sendMail(mailOptions);
    }
}

module.exports = new EmailService();
