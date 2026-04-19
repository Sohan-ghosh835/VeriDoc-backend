import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import summarizeRoute from './routes/summarize.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security Middleware
app.use(helmet()); // Sets secure HTTP headers

// Rate limiting: max 50 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 50,
  message: 'Too many requests from this IP, please try again after 15 minutes',
});
app.use(limiter);

// Configure CORS to only allow specific origins in production
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*', // Set your frontend URL in .env
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

// Routes
app.use('/api', summarizeRoute);

app.get('/', (req, res) => {
    res.send('VeriDoc AI Backend is running securely!');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
