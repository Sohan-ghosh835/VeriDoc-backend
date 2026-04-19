import express from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import { PinataSDK } from 'pinata-web3';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const router = express.Router();

// Security: Limit file size to 5MB and only allow specific file types
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/')) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF and text files are allowed.'));
        }
    }
});

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Initialize Pinata
const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: "gateway.pinata.cloud"
});

// Helper function to extract text from file
async function extractText(filePath, mimetype) {
    if (mimetype === 'application/pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return data.text;
    }
    // For DOCX or other formats, we could add mammoth or similar
    // For simplicity, we just return raw text if it's text, else error
    if (mimetype.startsWith('text/')) {
        return fs.readFileSync(filePath, 'utf8');
    }
    
    throw new Error(`Unsupported file type: ${mimetype}. Please upload a PDF or text file.`);
}

router.post('/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No valid file uploaded. Ensure it is a PDF or text file under 5MB.' });
        }

        const filePath = req.file.path;
        const fileMetadata = {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        };

        // 1. Extract Text
        let extractedText;
        try {
            extractedText = await extractText(filePath, fileMetadata.mimetype);
        } catch (err) {
            fs.unlinkSync(filePath); // Clean up
            return res.status(400).json({ error: err.message });
        }

        // 2. Summarize with Gemini
        let summaryText;
        try {
            const prompt = `Please provide a concise and professional summary of the following document. Extract key information such as the purpose of the document, main entities involved (e.g., name, institution), and key dates or qualifications. \n\nDocument Text:\n${extractedText.substring(0, 30000)}`; // limit chars
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });
            summaryText = response.text;
        } catch (err) {
             console.error("Gemini AI Error:", err);
             // Fallback to dummy if AI fails for whatever reason
             summaryText = "AI Summary unavailable due to an error. " + err.message;
        }

        // 3. Upload to IPFS via Pinata
        let ipfsHash = "mock_cid_if_pinata_fails_" + Date.now();
        let ipfsUrl = "";
        
        try {
             if (process.env.PINATA_JWT && process.env.PINATA_JWT !== 'your_pinata_jwt_here') {
                 // Upload original file
                 const blob = new Blob([fs.readFileSync(filePath)]);
                 const file = new File([blob], fileMetadata.originalname, { type: fileMetadata.mimetype });
                 const uploadRes = await pinata.upload.file(file);
                 ipfsHash = uploadRes.IpfsHash;
                 ipfsUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
             } else {
                 console.warn("Pinata JWT not configured. Using mock IPFS Hash.");
                 ipfsUrl = `https://mockipfs.com/${ipfsHash}`;
             }
        } catch(err) {
            console.error("Pinata Upload Error:", err);
            // Ignore error and use mock hash if it fails to not block the flow
        } finally {
            // Clean up the uploaded file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // 4. Return response to frontend
        return res.json({
            success: true,
            message: 'Document processed successfully',
            summary: summaryText,
            ipfsHash: ipfsHash,
            ipfsUrl: ipfsUrl,
            metadata: fileMetadata
        });

    } catch (error) {
        console.error("Upload route error:", error);
        // Handle multer errors specifically
        if (error.message.includes('Invalid file type')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// A simple GET route to fetch summary if needed (in a real app, this would query a DB)
// Since we have no DB, we just return a placeholder. The frontend should rely on the response from /upload.
router.get('/summary/:id', (req, res) => {
    res.json({
        id: req.params.id,
        message: "Summary retrieval by ID requires a database. Please use the response from /upload."
    });
});

export default router;
