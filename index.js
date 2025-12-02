const express = require('express');
const puppeteer = require('puppeteer');
require('dotenv').config();

const app = express();
app.use(express.json());

// Porta que o EasyPanel usa (geralmente 80 ou 3000)
const PORT = process.env.PORT || 80;

app.get('/', (req, res) => {
    res.send('O Bot do LinkedIn está ON! 🚀 Use POST /publicar para enviar.');
});

app.post('/publicar', async (req, res) => {
    const { texto, paginaUrl } = req.body;
    const email = process.env.LINKEDIN_EMAIL;
    const senha = process.env.LINKEDIN_PASSWORD;

    if (!texto || !email || !senha || !paginaUrl) {
        return res.status(400).json({ erro: 'Faltam dados: texto, email, senha ou paginaUrl.' });
    }

    console.log('Iniciando publicação...');
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true, // "true" para rodar no servidor invisível
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();

        // 1. Login
        await page.goto('https://www.linkedin.com/login');
        await page.type('#username', email);
        await page.type('#password', senha);
        await page.click('[type="submit"]');
        await page.waitForNavigation();

        // Verifica se pediu código de segurança (comum em servidores novos)
        if (await page.$('input[name="pin"]')) {
            throw new Error('O LinkedIn pediu verificação de 2FA. Precisa rodar localmente primeiro para pegar cookies.');
        }

        // 2. Vai para a página da empresa
        console.log('Indo para a página:', paginaUrl);
        await page.goto(paginaUrl);
        await new Promise(r => setTimeout(r, 5000)); // Espera carregar

        // 3. Clica para começar post (Tentativa genérica)
        // Tenta clicar no botão "Começar publicação" ou similar
        const btnSelector = 'button.share-box-feed-entry__trigger, button.share-box__open';
        await page.waitForSelector(btnSelector, { timeout: 10000 });
        await page.click(btnSelector);

        // 4. Digita o texto
        await new Promise(r => setTimeout(r, 2000));
        await page.keyboard.type(texto);
        await new Promise(r => setTimeout(r, 2000));

        // 5. Clica em Publicar
        const postBtnSelector = 'button.share-actions__primary-action';
        await page.waitForSelector(postBtnSelector);
        await page.click(postBtnSelector);

        console.log('Post enviado!');
        res.json({ status: 'sucesso', mensagem: 'Post publicado com sucesso!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: 'erro', detalhe: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
