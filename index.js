const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;
const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => res.send('Bot LinkedIn v4 (Cookies Edition) 🍪'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    const imagePath = req.file ? req.file.path : null;
    let browser = null;

    try {
        const { texto, paginaUrl, email, senha, cookies } = req.body;
        
        // Prioridade: Cookies > Login Senha
        const cookiesEnv = process.env.LINKEDIN_COOKIES;
        const cookiesFinal = cookies || cookiesEnv;

        if (!cookiesFinal && (!email || !senha)) {
            throw new Error('Você precisa enviar COOKIES (recomendado) ou Email/Senha.');
        }

        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
            defaultViewport: { width: 1920, height: 1080 }
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36');

        // --- ESTRATÉGIA DE LOGIN ---
        if (cookiesFinal) {
            console.log('🍪 Usando Cookies para login...');
            // Se o cookie vier como string (do n8n), converte para JSON
            const cookiesJson = typeof cookiesFinal === 'string' ? JSON.parse(cookiesFinal) : cookiesFinal;
            
            // Filtra apenas cookies do domínio linkedin
            const validCookies = Array.isArray(cookiesJson) ? cookiesJson : [];
            if (validCookies.length > 0) {
                await page.setCookie(...validCookies);
                console.log(`Carregados ${validCookies.length} cookies.`);
            }
        } else {
            console.log('🔑 Usando Email/Senha (Risco de Bloqueio)...');
            await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
            await page.type('#username', email);
            await page.type('#password', senha);
            await page.click('[type="submit"]');
            await page.waitForNavigation().catch(()=>{});
        }

        // --- IR PARA A PÁGINA ---
        console.log('Navegando para:', paginaUrl);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 5000));

        // Verifica se logou mesmo (se título for Sign Up, falhou)
        const title = await page.title();
        if (title.includes('Sign Up') || title.includes('Entrar') || title.includes('Join')) {
            throw new Error(`Login falhou! O LinkedIn redirecionou para: ${title}. Use Cookies novos.`);
        }

        // --- POSTAR ---
        console.log('Procurando botão de postar...');
        const texts = ['Começar', 'Start', 'Criar', 'Publicar'];
        const buttons = await page.$$('button, div[role="button"]');
        let found = false;

        for (const btn of buttons) {
            const t = await page.evaluate(el => el.textContent, btn);
            if (t && texts.some(x => t.includes(x))) {
                await btn.click();
                found = true;
                break;
            }
        }

        if (!found) {
            // Fallback seletor
            const btn = await page.$('button.share-box-feed-entry__trigger, button.share-box__open');
            if (btn) { await btn.click(); found = true; }
        }

        if (!found) throw new Error(`Botão não encontrado na página: ${title}`);

        await new Promise(r => setTimeout(r, 3000));

        // Upload Imagem
        if (imagePath) {
            console.log('Subindo imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 5000 }).catch(()=>null);
            if (input) {
                await input.uploadFile(imagePath);
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 20000 });
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // Texto
        if (texto) {
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]');
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // Publicar
        const btnPost = await page.waitForSelector('button.share-actions__primary-action');
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        console.log('SUCESSO!');
        res.json({ status: 'sucesso', mensagem: 'Postado via Cookies!' });

    } catch (error) {
        console.error('ERRO:', error.message);
        if (page) {
            await page.screenshot({ path: '/tmp/erro_cookies.png' });
            res.sendFile('/tmp/erro_cookies.png');
        } else {
            res.status(500).json({ erro: error.message });
        }
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(()=>{});
    }
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
