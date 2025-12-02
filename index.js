const express = require('express');
const puppeteer = require('puppeteer');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 80;

// Configuração do Multer para salvar imagens temporariamente na pasta /tmp do servidor
const upload = multer({ dest: '/tmp/uploads/' });

app.get('/', (req, res) => {
    res.send('Bot LinkedIn com Imagem ON! 🚀 Use POST /publicar (multipart/form-data).');
});

// NOTA IMPORTANTE: Agora usamos 'upload.single('imagem')' para processar o arquivo
app.post('/publicar', upload.single('imagem'), async (req, res) => {
    // O texto agora vem no req.body (graças ao multer)
    const { texto, paginaUrl } = req.body;
    // O caminho do arquivo da imagem (se foi enviado)
    const imagePath = req.file ? req.file.path : null;

    const email = process.env.LINKEDIN_EMAIL;
    const senha = process.env.LINKEDIN_PASSWORD;

    // Validação básica
    if (!email || !senha || !paginaUrl) {
        // Se houve upload mas faltou dados, apaga a imagem para não sujar o servidor
        if (imagePath) await fs.remove(imagePath);
        return res.status(400).json({ erro: 'Faltam dados: email, senha ou paginaUrl.' });
    }

    if (!texto && !imagePath) {
         return res.status(400).json({ erro: 'Você precisa enviar pelo menos um texto OU uma imagem.' });
    }

    console.log('Iniciando publicação...');
    if (imagePath) console.log('Imagem recebida para upload:', imagePath);

    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true, // Mude para false se estiver rodando localmente para ver
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1280, height: 800 }
        });

        const page = await browser.newPage();
        
        // --- 1. Login ---
        console.log('Fazendo login...');
        await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2' });
        await page.type('#username', email, { delay: 50 });
        await page.type('#password', senha, { delay: 50 });
        await page.click('[type="submit"]');
        
        try {
            await page.waitForNavigation({ timeout: 15000 });
        } catch (e) {
             // Às vezes o LinkedIn não navega, mas loga. Verifica se pediu PIN.
             if (await page.$('input[name="pin"]')) throw new Error('LinkedIn pediu verificação de 2FA.');
        }

        // --- 2. Navegar para a Página ---
        console.log('Indo para a página:', paginaUrl);
        await page.goto(paginaUrl, { waitUntil: 'domcontentloaded' });
        await new Promise(r => setTimeout(r, 3000)); // Espera carregar a interface de admin

        // --- 3. Abrir o Modal de Post ---
        console.log('Abrindo modal de post...');
        const btnStartPost = await page.waitForSelector('button.share-box-feed-entry__trigger, button.share-box__open', { visible: true, timeout: 10000 });
        await btnStartPost.click();
        await new Promise(r => setTimeout(r, 2000)); // Espera o modal abrir

        // --- 4. Upload da Imagem (SE HOUVER) ---
        if (imagePath) {
            console.log('Fazendo upload da imagem...');
            // O LinkedIn tem um input do tipo file escondido. Vamos achá-lo.
            // Às vezes precisamos clicar no botão de "Foto" primeiro para ativar o input.
            const photoButtonSelector = 'button[aria-label*="foto"], button[aria-label*="Photo"], button.share-actions__primary-action--media';
            
            try {
                 const photoBtn = await page.$(photoButtonSelector);
                 if(photoBtn) await photoBtn.click();
                 await new Promise(r => setTimeout(r, 1000));
            } catch (e) { console.log('Botão de foto não encontrado ou não necessário, tentando input direto.'); }

            const inputUpload = await page.waitForSelector('input[type="file"]', { timeout: 5000 });
            await inputUpload.uploadFile(imagePath);

            console.log('Aguardando processamento da imagem...');
            // Espera aparecer o container da imagem carregada (indica que o upload terminou)
            await page.waitForSelector('.share-creation-state__media-preview, img[alt*="Preview"]', { visible: true, timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000)); // Mais um tempo de segurança
        }

        // --- 5. Digitar o Texto (SE HOUVER) ---
        if (texto) {
            console.log('Digitando texto...');
            const editorSelector = '.ql-editor, div[role="textbox"][aria-label*="post"]';
            await page.waitForSelector(editorSelector);
            await page.click(editorSelector);
            await page.keyboard.type(texto, { delay: 30 });
            await new Promise(r => setTimeout(r, 1000));
        }

        // --- 6. Clicar em Publicar ---
        console.log('Clicando em Publicar...');
        const postBtnSelector = 'button.share-actions__primary-action';
        const postBtn = await page.waitForSelector(postBtnSelector, { visible: true });
        
        // Verifica se o botão está habilitado antes de clicar
        const isDisabled = await page.evaluate(el => el.disabled, postBtn);
        if (isDisabled) throw new Error('Botão de publicar ainda está desabilitado (talvez a imagem não tenha carregado).');

        await postBtn.click();
        await new Promise(r => setTimeout(r, 5000)); // Espera a confirmação do post

        console.log('Post enviado com sucesso!');
        res.json({ status: 'sucesso', mensagem: 'Post com imagem publicado!' });

    } catch (error) {
        console.error('ERRO NO PUPPETEER:', error);
        // Tira um print se der erro para debug (opcional, se tiver como ver no easypanel)
        if (browser) {
             try { await page.screenshot({ path: '/tmp/erro_linkedin.png' }); } catch(e){}
        }
        res.status(500).json({ status: 'erro', detalhe: error.message });
    } finally {
        // --- LIMPEZA ---
        // Fecha o navegador
        if (browser) await browser.close();
        // Apaga a imagem temporária do servidor para não encher o disco
        if (imagePath) {
            await fs.remove(imagePath);
            console.log('Arquivo temporário limpo:', imagePath);
        }
    }
});

app.listen(PORT, () => {
    console.log(`Servidor API do Bot rodando na porta ${PORT}`);
});
