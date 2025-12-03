const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;

const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => res.send('Bot LinkedIn V3 (Busca por Texto) 🚀'));

app.post('/publicar', upload.single('imagem'), async (req, res) => {
    const imagePath = req.file ? req.file.path : null;
    let browser = null;

    try {
        console.log('--- NOVA REQUISIÇÃO ---');
        const { texto, paginaUrl, email: emailBody, senha: senhaBody } = req.body;
        const email = emailBody || process.env.LINKEDIN_EMAIL;
        const senha = senhaBody || process.env.LINKEDIN_PASSWORD;

        if (!email || !senha || !paginaUrl) throw new Error('Dados incompletos (Email, Senha ou URL).');

        // 1. Configura Navegador em modo DESKTOP GRANDE (Para evitar layout mobile)
        browser = await puppeteer.launch({
            headless: true, // Mude para false se testar localmente
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'],
            defaultViewport: { width: 1920, height: 1080 }
        });

        const page = await browser.newPage();
        
        // Disfarça o robô
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        // --- LOGIN ---
        console.log('Logando...');
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
        await page.type('#username', email, { delay: 50 });
        await page.type('#password', senha, { delay: 50 });
        await page.click('[type="submit"]');
        await page.waitForNavigation({ timeout: 20000 }).catch(() => console.log('Timeout navegação login (pode ser normal)'));

        // Checa verificação
        if (await page.$('input[name="pin"]')) throw new Error('BLOQUEIO: LinkedIn pediu PIN de verificação.');

        // --- IR PARA PÁGINA ---
        console.log('Indo para URL:', paginaUrl);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 6000)); // Espera generosa para carregar tudo

        // --- A MÁGICA: CLICAR POR TEXTO ---
        console.log('Procurando botão de postar...');
        
        // Tenta achar qualquer botão que contenha estas palavras
        const textsToFind = ['Começar publicação', 'Start a post', 'Crear publicación', 'Começar'];
        let clicked = false;

        // Estratégia 1: Seletores CSS Clássicos
        const selectors = [
            'button.share-box-feed-entry__trigger',
            'button.share-box__open',
            'div.share-box-feed-entry__trigger'
        ];

        for (const sel of selectors) {
            if (await page.$(sel)) {
                console.log(`Botão encontrado via seletor: ${sel}`);
                await page.click(sel);
                clicked = true;
                break;
            }
        }

        // Estratégia 2: Busca por TEXTO (Se a 1 falhar)
        if (!clicked) {
            console.log('Seletores falharam. Tentando busca por texto...');
            // Pega todos os botões da página
            const buttons = await page.$$('button, div[role="button"], span');
            
            for (const btn of buttons) {
                const text = await page.evaluate(el => el.textContent, btn);
                if (text && textsToFind.some(t => text.includes(t))) {
                    console.log(`Botão encontrado por texto: "${text.trim()}"`);
                    await btn.click();
                    clicked = true;
                    break;
                }
            }
        }

        if (!clicked) {
            // Tira um print do "erro" no console (HTML da página) para sabermos onde estamos
            const pageTitle = await page.title();
            throw new Error(`Não consegui clicar. Título da página: ${pageTitle}. O robô pode estar na página errada ou logado na conta errada.`);
        }

        await new Promise(r => setTimeout(r, 3000)); // Espera modal abrir

        // --- UPLOAD IMAGEM ---
        if (imagePath) {
            console.log('Enviando imagem...');
            const input = await page.waitForSelector('input[type="file"]', { timeout: 5000 }).catch(() => null);
            if (input) {
                await input.uploadFile(imagePath);
                await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { timeout: 20000 });
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.log('Aviso: Input de arquivo não achado, postando sem imagem.');
            }
        }

        // --- TEXTO ---
        if (texto) {
            console.log('Escrevendo texto...');
            const editor = await page.waitForSelector('.ql-editor, div[role="textbox"]', { timeout: 5000 });
            await editor.click();
            await page.keyboard.type(texto, { delay: 10 });
        }

        // --- PUBLICAR ---
        console.log('Finalizando...');
        const btnPost = await page.waitForSelector('button.share-actions__primary-action', { visible: true });
        
        // Clica (às vezes precisa clicar duas vezes se tiver menu suspenso)
        await btnPost.click();
        await new Promise(r => setTimeout(r, 5000));

        console.log('SUCESSO TOTAL!');
        res.json({ status: 'sucesso', mensagem: 'Postado com força bruta!' });

    } catch (error) {
        console.error('ERRO FATAL:', error.message);
        res.status(500).json({ status: 'erro', mensagem: error.message });
    } finally {
        if (browser) await browser.close();
        if (imagePath) await fs.remove(imagePath).catch(() => {});
    }
});

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
