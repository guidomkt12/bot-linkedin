require('dotenv').config();
const fs = require('fs-extra');
const puppeteer = require('puppeteer');

(async () => {
  console.log('Iniciando bot...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  console.log('Acessando LinkedIn...');
  
  // Acessa o LinkedIn só para testar
  await page.goto('https://www.linkedin.com/', { waitUntil: 'networkidle2' });
  
  const title = await page.title();
  console.log('Título da página:', title);
  console.log('Sucesso! O Puppeteer está rodando.');

  await browser.close();
})();
