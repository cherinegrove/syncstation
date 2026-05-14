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
        
        this.fromEmail = process.env.FROM_EMAIL || 'noreply@syncstation.app';
        this.fromName = process.env.FROM_NAME || 'SyncStation';
        this.appUrl = process.env.APP_URL || 'https://portal.syncstation.app';
    }
    
    /**
     * Send email verification
     */
    async sendVerificationEmail(email, fullName, verificationToken) {
        const verificationUrl = `${this.appUrl}/verify-email?token=${verificationToken}`;
        
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: 'Verify Your SyncStation Account',
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
                            <h1>Welcome to SyncStation!</h1>
                        </div>
                        <div class="content">
                            <p>Hi ${fullName},</p>
                            <p>Thank you for registering with SyncStation. Please verify your email address to complete your account setup.</p>
                            <p style="text-align: center;">
                                <a href="${verificationUrl}" class="button">Verify Email Address</a>
                            </p>
                            <p>Or copy and paste this link into your browser:</p>
                            <p style="word-break: break-all; color: #2563eb;">${verificationUrl}</p>
                            <p>This link will expire in 24 hours.</p>
                            <p>If you didn't create an account with SyncStation, please ignore this email.</p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} SyncStation. All rights reserved.</p>
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
            subject: 'Reset Your SyncStation Password',
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
                            <p>We received a request to reset your password for your SyncStation account.</p>
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
                            <p>© ${new Date().getFullYear()} SyncStation. All rights reserved.</p>
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
            subject: `${inviterName} invited you to join SyncStation`,
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
                            <p><strong>${inviterName}</strong> has invited you to collaborate on their HubSpot portal using SyncStation.</p>
                            
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
                            <p>© ${new Date().getFullYear()} SyncStation. All rights reserved.</p>
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
            subject: `${inviterName} added you to their SyncStation portal`,
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
                            <p>You can now access this portal using your existing SyncStation account.</p>
                            <p style="text-align: center;">
                                <a href="${loginUrl}" class="button">Login Now</a>
                            </p>
                            <p>Your new portal will appear in your portal selector after login.</p>
                        </div>
                        <div class="footer">
                            <p>© ${new Date().getFullYear()} SyncStation. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };
        
        return this.transporter.sendMail(mailOptions);
    }

    /**
     * Send invite link email — recipient clicks link and sets their own password
     */
    async sendInviteEmail(email, inviterName, portalId, inviteUrl) {
        const mailOptions = {
            from: `"${this.fromName}" <${this.fromEmail}>`,
            to: email,
            subject: `${inviterName} invited you to join SyncStation`,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f4f4f4; }
                        .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; }
                        .header { background: #0F0F11; padding: 30px; text-align: center; }
                        .header img { height: 32px; }
                        .header h1 { color: #F0F0F4; font-size: 22px; margin-top: 16px; }
                        .content { padding: 40px 30px; }
                        .content p { color: #555; margin-bottom: 16px; }
                        .button-wrap { text-align: center; margin: 32px 0; }
                        .button {
                            display: inline-block;
                            background: #FF6B35;
                            color: white !important;
                            padding: 14px 36px;
                            text-decoration: none;
                            border-radius: 6px;
                            font-weight: 600;
                            font-size: 15px;
                        }
                        .url-fallback { background: #f9f9f9; border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px; font-size: 12px; word-break: break-all; color: #666; }
                        .footer { text-align: center; padding: 20px; color: #999; font-size: 12px; background: #f9f9f9; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>🔄 SyncStation</h1>
                        </div>
                        <div class="content">
                            <p>Hi there,</p>
                            <p><strong>${inviterName}</strong> has invited you to join their HubSpot portal on SyncStation — a tool that automatically syncs property values between CRM objects.</p>
                            <p>Click the button below to create your account and get started. The link expires in 7 days.</p>
                            <div class="button-wrap">
                                <a href="${inviteUrl}" class="button">Accept Invite & Set Password</a>
                            </div>
                            <p style="font-size:13px;color:#888;">If the button doesn't work, copy and paste this link into your browser:</p>
                            <div class="url-fallback">${inviteUrl}</div>
                        </div>
                        <div class="footer">
                            <p>If you weren't expecting this invitation, you can safely ignore this email.</p>
                            <p>© ${new Date().getFullYear()} SyncStation. All rights reserved.</p>
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
