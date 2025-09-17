#!/bin/bash

# 🚀 Space Unicorns Shop - Deployment Script
# Questo script automatizza il deployment su VPS

set -e  # Exit on any error

echo "🦄 Starting Space Unicorns Shop Deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="space-unicorns-shop"
APP_DIR="/var/www/space-unicorns"
NGINX_SITE="/etc/nginx/sites-available/space-unicorns"
DOMAIN=${1:-"your-domain.com"}

echo -e "${BLUE}🌐 Domain: $DOMAIN${NC}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_warning "Running as root. Consider using a non-root user for security."
fi

# 1. Update system
echo -e "${BLUE}📦 Updating system packages...${NC}"
sudo apt update && sudo apt upgrade -y
print_status "System updated"

# 2. Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo -e "${BLUE}📦 Installing Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    print_status "Node.js installed"
else
    print_status "Node.js already installed ($(node --version))"
fi

# 3. Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo -e "${BLUE}📦 Installing PM2...${NC}"
    sudo npm install -g pm2
    print_status "PM2 installed"
else
    print_status "PM2 already installed"
fi

# 4. Install Nginx if not present
if ! command -v nginx &> /dev/null; then
    echo -e "${BLUE}📦 Installing Nginx...${NC}"
    sudo apt install nginx -y
    sudo systemctl start nginx
    sudo systemctl enable nginx
    print_status "Nginx installed and started"
else
    print_status "Nginx already installed"
fi

# 5. Create app directory
echo -e "${BLUE}📁 Setting up application directory...${NC}"
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR
print_status "App directory created: $APP_DIR"

# 6. Copy application files
echo -e "${BLUE}📋 Copying application files...${NC}"
cp -r ./* $APP_DIR/
cd $APP_DIR
print_status "Files copied to $APP_DIR"

# 7. Install dependencies
echo -e "${BLUE}📦 Installing application dependencies...${NC}"
npm install --production
print_status "Dependencies installed"

# 8. Setup environment
if [ ! -f ".env" ]; then
    echo -e "${BLUE}⚙️  Setting up environment file...${NC}"
    cp env.example .env
    print_warning "Please edit .env file with your Stripe keys!"
    print_warning "nano $APP_DIR/.env"
else
    print_status "Environment file already exists"
fi

# 9. Create logs directory
mkdir -p logs
print_status "Logs directory created"

# 10. Configure Nginx
echo -e "${BLUE}🌐 Configuring Nginx...${NC}"
sudo cp nginx.conf $NGINX_SITE

# Replace domain placeholder
sudo sed -i "s/your-domain.com/$DOMAIN/g" $NGINX_SITE

# Enable site
sudo ln -sf $NGINX_SITE /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
if sudo nginx -t; then
    sudo systemctl restart nginx
    print_status "Nginx configured and restarted"
else
    print_error "Nginx configuration error"
    exit 1
fi

# 11. Setup firewall
echo -e "${BLUE}🔒 Configuring firewall...${NC}"
if command -v ufw &> /dev/null; then
    sudo ufw --force enable
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow ssh
    sudo ufw allow 'Nginx Full'
    print_status "Firewall configured"
else
    sudo apt install ufw -y
    print_status "UFW installed and configured"
fi

# 12. Start application with PM2
echo -e "${BLUE}🚀 Starting application with PM2...${NC}"
pm2 stop $APP_NAME 2>/dev/null || true
pm2 delete $APP_NAME 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup | grep -E '^sudo ' | bash
print_status "Application started with PM2"

# 13. Setup SSL (if domain is not placeholder)
if [ "$DOMAIN" != "your-domain.com" ]; then
    echo -e "${BLUE}🔐 Setting up SSL certificate...${NC}"
    if command -v certbot &> /dev/null; then
        sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
        print_status "SSL certificate installed"
    else
        sudo apt install certbot python3-certbot-nginx -y
        print_warning "Certbot installed. Run manually: sudo certbot --nginx -d $DOMAIN"
    fi
else
    print_warning "Using placeholder domain. Configure real domain and run SSL setup manually."
fi

# 14. Final checks
echo -e "${BLUE}🧪 Running final checks...${NC}"

# Check if app is running
if pm2 list | grep -q $APP_NAME; then
    print_status "PM2 app is running"
else
    print_error "PM2 app is not running"
fi

# Check if Nginx is running
if systemctl is-active --quiet nginx; then
    print_status "Nginx is running"
else
    print_error "Nginx is not running"
fi

# Check if port 3000 is listening
if netstat -tuln | grep -q ":3000 "; then
    print_status "App is listening on port 3000"
else
    print_error "App is not listening on port 3000"
fi

echo ""
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETED!${NC}"
echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
echo "1. Edit environment file: nano $APP_DIR/.env"
echo "2. Add your Stripe live keys"
echo "3. Configure webhook on Stripe Dashboard"
echo "4. Test the site: https://$DOMAIN"
echo ""
echo -e "${BLUE}🛠️  Useful Commands:${NC}"
echo "pm2 status              # Check app status"
echo "pm2 logs $APP_NAME      # View logs"
echo "pm2 restart $APP_NAME   # Restart app"
echo "sudo systemctl status nginx  # Check Nginx"
echo ""
echo -e "${BLUE}🔗 Your site should be available at:${NC}"
echo "https://$DOMAIN"
echo ""
echo -e "${YELLOW}⚠️  Remember to:${NC}"
echo "- Configure your Stripe live keys in .env"
echo "- Set up webhook endpoint on Stripe Dashboard"
echo "- Test payments with real cards"
echo "- Monitor logs for any issues"

