// ============================================================
// WHATIF - COMPLETE BACKEND
// Node.js + Express
// ============================================================

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const fs = require("fs");
const path = require("path");

// ------------------------------------------------------------
// APP SETUP
// ------------------------------------------------------------

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET =
    process.env.JWT_SECRET || "development-secret-change-me";

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

app.use(
    cors({
        origin: true,
        credentials: true
    })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Basic API rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api", apiLimiter);

// ------------------------------------------------------------
// SIMPLE JSON DATABASE
// ------------------------------------------------------------

const DATA_FILE = path.join(__dirname, "whatif-data.json");

function createDatabase() {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                {
                    users: [],
                    history: []
                },
                null,
                2
            )
        );
    }
}

function readDatabase() {
    createDatabase();

    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch (error) {
        return {
            users: [],
            history: []
        };
    }
}

function writeDatabase(data) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(data, null, 2)
    );
}

createDatabase();

// ------------------------------------------------------------
// GENERAL HELPERS
// ------------------------------------------------------------

function success(res, data = {}) {
    return res.json({
        success: true,
        data
    });
}

function errorResponse(res, status, message) {
    return res.status(status).json({
        success: false,
        error: message
    });
}

function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateId() {
    return (
        Date.now().toString(36) +
        Math.random().toString(36).substring(2, 8)
    );
}

// ------------------------------------------------------------
// JWT AUTHENTICATION
// ------------------------------------------------------------

function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email
        },
        JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );
}

function authMiddleware(req, res, next) {
    let token = req.cookies?.whatif_token;

    // Also allow Authorization: Bearer TOKEN
    if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(" ");

        if (
            parts.length === 2 &&
            parts[0] === "Bearer"
        ) {
            token = parts[1];
        }
    }

    if (!token) {
        return errorResponse(
            res,
            401,
            "Authentication required."
        );
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        const db = readDatabase();

        const user = db.users.find(
            (u) => u.id === decoded.id
        );

        if (!user) {
            return errorResponse(
                res,
                401,
                "User no longer exists."
            );
        }

        req.user = {
            id: user.id,
            email: user.email
        };

        next();
    } catch (error) {
        return errorResponse(
            res,
            401,
            "Invalid or expired authentication."
        );
    }
}

// ------------------------------------------------------------
// HEALTH CHECK
// ------------------------------------------------------------

app.get("/api/health", (req, res) => {
    success(res, {
        message: "WhatIf backend is running",
        time: new Date().toISOString()
    });
});

// ============================================================
// AUTHENTICATION
// ============================================================

// ------------------------------------------------------------
// SIGNUP
// ------------------------------------------------------------

app.post("/api/auth/signup", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return errorResponse(
                res,
                400,
                "Email and password are required."
            );
        }

        const cleanEmail = String(email)
            .trim()
            .toLowerCase();

        if (!validEmail(cleanEmail)) {
            return errorResponse(
                res,
                400,
                "Enter a valid email address."
            );
        }

        if (String(password).length < 6) {
            return errorResponse(
                res,
                400,
                "Password must contain at least 6 characters."
            );
        }

        const db = readDatabase();

        const existingUser = db.users.find(
            (u) => u.email === cleanEmail
        );

        if (existingUser) {
            return errorResponse(
                res,
                409,
                "An account with this email already exists."
            );
        }

        const passwordHash = await bcrypt.hash(
            password,
            12
        );

        const user = {
            id: generateId(),
            email: cleanEmail,
            passwordHash,
            createdAt: new Date().toISOString()
        };

        db.users.push(user);

        writeDatabase(db);

        const token = createToken(user);

        res.cookie("whatif_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return success(res, {
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Signup error:", error);

        return errorResponse(
            res,
            500,
            "Unable to create account."
        );
    }
});

// ------------------------------------------------------------
// LOGIN
// ------------------------------------------------------------

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return errorResponse(
                res,
                400,
                "Email and password are required."
            );
        }

        const cleanEmail = String(email)
            .trim()
            .toLowerCase();

        const db = readDatabase();

        const user = db.users.find(
            (u) => u.email === cleanEmail
        );

        if (!user) {
            return errorResponse(
                res,
                401,
                "Invalid email or password."
            );
        }

        const validPassword = await bcrypt.compare(
            password,
            user.passwordHash
        );

        if (!validPassword) {
            return errorResponse(
                res,
                401,
                "Invalid email or password."
            );
        }

        const token = createToken(user);

        res.cookie("whatif_token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return success(res, {
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Login error:", error);

        return errorResponse(
            res,
            500,
            "Unable to login."
        );
    }
});

// ------------------------------------------------------------
// CURRENT USER
// ------------------------------------------------------------

app.get(
    "/api/auth/me",
    authMiddleware,
    (req, res) => {
        return success(res, {
            user: req.user
        });
    }
);

// ------------------------------------------------------------
// LOGOUT
// ------------------------------------------------------------

app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("whatif_token");

    return success(res, {
        message: "Logged out successfully."
    });
});

// ============================================================
// TECHNICAL INDICATORS
// ============================================================

// ------------------------------------------------------------
// SMA
// ------------------------------------------------------------

function calculateSMA(values, period = 20) {
    if (!Array.isArray(values)) return [];

    const result = [];

    for (let i = 0; i < values.length; i++) {
        if (i + 1 < period) {
            result.push(null);
            continue;
        }

        const window = values.slice(
            i + 1 - period,
            i + 1
        );

        const average =
            window.reduce((a, b) => a + b, 0) /
            period;

        result.push(average);
    }

    return result;
}

// ------------------------------------------------------------
// EMA
// ------------------------------------------------------------

function calculateEMA(values, period = 12) {
    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {
        return [];
    }

    const result = new Array(values.length).fill(null);

    if (values.length < period) {
        return result;
    }

    let sum = 0;

    for (let i = 0; i < period; i++) {
        sum += values[i];
    }

    let previousEMA = sum / period;

    result[period - 1] = previousEMA;

    const multiplier = 2 / (period + 1);

    for (let i = period; i < values.length; i++) {
        previousEMA =
            (values[i] - previousEMA) *
                multiplier +
            previousEMA;

        result[i] = previousEMA;
    }

    return result;
}

// ------------------------------------------------------------
// RSI
// ------------------------------------------------------------

function calculateRSI(values, period = 14) {
    if (
        !Array.isArray(values) ||
        values.length <= period
    ) {
        return [];
    }

    const result = new Array(values.length).fill(null);

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change =
            values[i] - values[i - 1];

        if (change >= 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let averageGain = gains / period;
    let averageLoss = losses / period;

    result[period] =
        averageLoss === 0
            ? 100
            : 100 -
              100 /
                  (1 +
                      averageGain /
                          averageLoss);

    for (
        let i = period + 1;
        i < values.length;
        i++
    ) {
        const change =
            values[i] - values[i - 1];

        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        averageGain =
            (averageGain * (period - 1) +
                gain) /
            period;

        averageLoss =
            (averageLoss * (period - 1) +
                loss) /
            period;

        if (averageLoss === 0) {
            result[i] = 100;
        } else {
            const rs =
                averageGain / averageLoss;

            result[i] = 100 - 100 / (1 + rs);
        }
    }

    return result;
}

// ------------------------------------------------------------
// MACD
// ------------------------------------------------------------

function calculateMACD(
    values,
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
) {
    const fastEMA = calculateEMA(
        values,
        fastPeriod
    );

    const slowEMA = calculateEMA(
        values,
        slowPeriod
    );

    const macd = values.map((_, i) => {
        if (
            fastEMA[i] === null ||
            slowEMA[i] === null
        ) {
            return null;
        }

        return fastEMA[i] - slowEMA[i];
    });

    const validMACD = macd.filter(
        (value) => value !== null
    );

    const signalValues = calculateEMA(
        validMACD,
        signalPeriod
    );

    const signal = new Array(values.length).fill(
        null
    );

    let j = 0;

    for (let i = 0; i < values.length; i++) {
        if (macd[i] !== null) {
            signal[i] = signalValues[j];
            j++;
        }
    }

    return {
        macd,
        signal
    };
}

// ------------------------------------------------------------
// RETURNS
// ------------------------------------------------------------

function calculateReturns(values) {
    const returns = [];

    for (let i = 1; i < values.length; i++) {
        if (
            values[i - 1] === 0 ||
            values[i - 1] == null ||
            values[i] == null
        ) {
            continue;
        }

        returns.push(
            (values[i] - values[i - 1]) /
                values[i - 1]
        );
    }

    return returns;
}

// ------------------------------------------------------------
// VOLATILITY
// ------------------------------------------------------------

function calculateVolatility(returns) {
    if (returns.length < 2) return 0;

    const mean =
        returns.reduce(
            (a, b) => a + b,
            0
        ) / returns.length;

    const variance =
        returns.reduce(
            (sum, value) =>
                sum +
                Math.pow(value - mean, 2),
            0
        ) /
        (returns.length - 1);

    return Math.sqrt(variance) * Math.sqrt(252);
}

// ------------------------------------------------------------
// DRAWDOWN
// ------------------------------------------------------------

function calculateDrawdown(values) {
    if (!values.length) return 0;

    let peak = values[0];
    let maxDrawdown = 0;

    for (const value of values) {
        if (value > peak) {
            peak = value;
        }

        if (peak !== 0) {
            const drawdown =
                (value - peak) / peak;

            if (drawdown < maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }
    }

    return Math.abs(maxDrawdown);
}

// ------------------------------------------------------------
// PERCENT CHANGE
// ------------------------------------------------------------

function calculatePercentChange(
    current,
    previous
) {
    if (
        previous === 0 ||
        previous == null ||
        current == null
    ) {
        return 0;
    }

    return (
        ((current - previous) / previous) *
        100
    );
}

// ============================================================
// MARKET DATA
// ============================================================

const ASSETS = {
    bitcoin: {
        symbol: "BTC-USD",
        name: "Bitcoin"
    },

    nvidia: {
        symbol: "NVDA",
        name: "NVIDIA"
    },

    gold: {
        symbol: "GC=F",
        name: "Gold"
    }
};

// ------------------------------------------------------------
// FETCH YAHOO FINANCE DATA
// ------------------------------------------------------------

async function fetchMarketData(
    asset,
    start,
    end
) {
    const meta = ASSETS[asset];

    if (!meta) {
        throw new Error("Unsupported asset.");
    }

    const now =
        Math.floor(Date.now() / 1000);

    const defaultStart =
        now -
        365 *
            24 *
            60 *
            60;

    const period1 = start
        ? Math.floor(
              new Date(start).getTime() /
                  1000
          )
        : defaultStart;

    const period2 = end
        ? Math.floor(
              new Date(end).getTime() /
                  1000
          )
        : now;

    const url =
        "https://query1.finance.yahoo.com/v8/finance/chart/" +
        encodeURIComponent(meta.symbol) +
        `?period1=${period1}&period2=${period2}&interval=1d`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            "Market data provider unavailable."
        );
    }

    const json = await response.json();

    const result =
        json?.chart?.result?.[0];

    if (!result) {
        throw new Error(
            "No market data available."
        );
    }

    const timestamps =
        result.timestamp || [];

    const quote =
        result.indicators?.quote?.[0];

    const data = [];

    for (
        let i = 0;
        i < timestamps.length;
        i++
    ) {
        if (
            quote.close?.[i] == null
        ) {
            continue;
        }

        data.push({
            date: new Date(
                timestamps[i] * 1000
            )
                .toISOString()
                .split("T")[0],

            timestamp: timestamps[i],

            open: quote.open?.[i] ?? null,
            high: quote.high?.[i] ?? null,
            low: quote.low?.[i] ?? null,
            close: quote.close?.[i] ?? null,
            volume: quote.volume?.[i] ?? 0
        });
    }

    return data;
}

// ------------------------------------------------------------
// MARKET ENDPOINT
// ------------------------------------------------------------

app.get(
    "/api/market/:asset",
    async (req, res) => {
        try {
            const asset =
                req.params.asset.toLowerCase();

            if (!ASSETS[asset]) {
                return errorResponse(
                    res,
                    400,
                    "Unsupported asset."
                );
            }

            const data =
                await fetchMarketData(
                    asset,
                    req.query.start,
                    req.query.end
                );

            return success(res, {
                asset,
                symbol: ASSETS[asset].symbol,
                name: ASSETS[asset].name,
                data
            });
        } catch (error) {
            console.error(
                "Market error:",
                error.message
            );

            return errorResponse(
                res,
                502,
                "Unable to retrieve market data."
            );
        }
    }
);

// ============================================================
// NEWS
// ============================================================

app.get(
    "/api/market/:asset/news",
    async (req, res) => {
        const asset =
            req.params.asset.toLowerCase();

        if (!ASSETS[asset]) {
            return errorResponse(
                res,
                400,
                "Unsupported asset."
            );
        }

        const fallbackNews = {
            bitcoin: [
                {
                    source: "Bitcoin Desk",
                    title: "Bitcoin continues to trade on macro sentiment, liquidity, and ETF demand cues."
                },
                {
                    source: "Macro Lens",
                    title: "Crypto sentiment remains highly responsive to rate expectations and risk appetite."
                },
                {
                    source: "Market Pulse",
                    title: "Analysts continue to watch volatility and institutional flows for directional clues."
                }
            ],
            nvidia: [
                {
                    source: "Chip Brief",
                    title: "AI infrastructure demand remains central to semiconductor market narratives."
                },
                {
                    source: "Growth Signal",
                    title: "NVIDIA continues to attract attention from earnings and data-center growth expectations."
                },
                {
                    source: "Equity Radar",
                    title: "The stock often reacts to guidance, supply trends, and broader AI adoption commentary."
                }
            ],
            gold: [
                {
                    source: "Commodity Wire",
                    title: "Gold often responds to inflation expectations, real rates, and central bank policy."
                },
                {
                    source: "Macro Outlook",
                    title: "Gold continues to act as a diversification anchor across uncertain market conditions."
                },
                {
                    source: "Portfolio Brief",
                    title: "Investors monitor gold as a hedge against volatility and inflation pressure."
                }
            ]
        };

        return success(res, {
            asset,
            items: fallbackNews[asset] || []
        });
    }
);

// ============================================================
// AI FINANCE TUTOR
// ============================================================

function buildTutorResponse(prompt) {
    const text = String(prompt || "").trim().toLowerCase();

    if (!text) {
        return "Please ask a finance question and I can explain it in a simple, practical way.";
    }

    if (text.includes("rsi")) {
        return "RSI stands for Relative Strength Index. It measures the speed and change of price moves on a 0 to 100 scale. Readings above 70 usually suggest an asset may be overbought, while readings below 30 often suggest it may be oversold. RSI is useful for momentum analysis, but it is not a guarantee that a price will reverse immediately. A strong trend can stay above 70 or below 30 for a while, so traders usually pair RSI with trend analysis or confirmation from price action.";
    }

    if (text.includes("macd")) {
        return "MACD is the Moving Average Convergence Divergence indicator. It compares a short-term moving average to a longer-term one. When the MACD line crosses above its signal line, it often signals stronger momentum. When it crosses below, momentum may be weakening. MACD helps identify trend direction and momentum shifts, but it is best used with context, not as a stand-alone buy or sell rule.";
    }

    if (text.includes("moving average") || text.includes("crossover")) {
        return "A moving average smooths price data so you can see the direction of the trend more clearly. A short-term moving average reacts faster, while a long-term moving average reacts more slowly. A crossover occurs when the faster average moves above or below the slower one. This can signal a trend change or a momentum shift, but it works best when combined with other checks such as volume, market context, and risk management.";
    }

    if (text.includes("diversif") || text.includes("portfolio") || text.includes("allocation") || text.includes("asset allocation")) {
        return "Diversification means spreading investments across different assets, sectors, or strategies instead of putting everything in one place. The goal is to reduce the impact of any single asset performing badly. Diversification cannot eliminate risk entirely, but it can lower the chance that one sharp move damages the whole portfolio. A balanced portfolio usually mixes assets with different drivers, such as equities, bonds, gold, or other defensive holdings.";
    }

    if (text.includes("interest rate") || text.includes("fed") || text.includes("central bank") || text.includes("rate cut") || text.includes("rate hike")) {
        return "Interest rates are the cost of borrowing money and the return on saving or lending funds. Central banks often adjust rates to influence inflation, growth, and financial stability. Higher rates can slow borrowing and investment, while lower rates can stimulate activity, but they also affect asset valuation and bond returns.";
    }

    if (text.includes("compound") || text.includes("interest") || text.includes("time value") || text.includes("future value") || text.includes("present value")) {
        return "Compound interest means earning returns on both your original money and the gains that have already been added. Over time, this creates exponential growth because each cycle adds more value. The longer the time horizon, the more powerful compounding becomes. This is why starting early and staying invested often matters more than trying to time the market perfectly.";
    }

    if (text.includes("backtest") || text.includes("backtesting")) {
        return "Backtesting means testing a trading or investing rule against historical data to see how it would have behaved in the past. It is useful for learning whether a strategy is logically sound and whether it tends to work across different market conditions. However, backtest results are not guarantees for future results because market conditions, costs, and behavior change over time. Good backtests should be realistic and include risk limits, transaction costs, and clear decision rules.";
    }

    if (text.includes("risk") || text.includes("drawdown") || text.includes("volatility") || text.includes("beta") || text.includes("variance")) {
        return "Risk is the chance that an investment moves against you. Volatility measures how much prices swing over time, while drawdown measures how much value falls from a recent peak. In practical terms, risk management means sizing positions carefully, understanding loss potential, and avoiding the temptation to assume every large gain comes without danger. Smart investors focus on both returns and the risk needed to achieve them.";
    }

    if (text.includes("var") || text.includes("value at risk")) {
        return "Value at Risk, or VaR, estimates how much a portfolio could lose over a chosen time period under normal market conditions at a given confidence level. For example, a 95% daily VaR asks: what is the likely worst daily loss in 95 out of 100 normal days? VaR is a useful risk summary, but it does not capture every possible extreme event and should be used alongside other risk checks like drawdown and scenario analysis.";
    }

    if (text.includes("bitcoin") || text.includes("crypto") || text.includes("cryptocurrency")) {
        return "Bitcoin is a digital asset that can be highly volatile compared with traditional assets. Its price is influenced by adoption, regulation, market sentiment, liquidity, and macroeconomic conditions. Bitcoin may offer growth potential, but it also carries significant price swings and risk. In a portfolio, it is often used as a smaller allocation rather than as the only investment because risk management matters.";
    }

    if (text.includes("gold") || text.includes("commodity")) {
        return "Gold is often treated as a diversifier and a hedge against inflation or uncertain markets. It can behave differently from stocks because it reacts to interest rates, inflation expectations, and global uncertainty. Gold can play a useful role in diversification, but it is not always the highest-return asset in the short term. It is often valued for balance and stability in a broader portfolio.";
    }

    if (text.includes("nvidia") || text.includes("stock") || text.includes("equity") || text.includes("earnings") || text.includes("valuation") || text.includes("pe ratio")) {
        return "When evaluating a stock, it helps to look at the business, its earnings, valuation, and the market environment. Price alone does not prove quality or future returns. Investors usually combine fundamental checks such as revenue growth, margins, debt, and cash flow with chart context and risk management before making a decision.";
    }

    if (text.includes("inflation") || text.includes("cpi") || text.includes("consumer price")) {
        return "Inflation means prices are rising over time, which reduces the purchasing power of money. It matters because it influences interest rates, wages, bond yields, and asset prices. Investors often care about inflation because it can increase costs, pressure margins, and change the real return on investments after adjusting for price increases.";
    }

    if (text.includes("bond") || text.includes("yield") || text.includes("treasury")) {
        return "Bonds are loans made to governments or companies, and they typically pay interest over time. Bond yields reflect the return investors receive relative to the price paid. When yields rise, bond prices usually fall, and vice versa. Bonds can provide income and reduce overall portfolio volatility, though they do carry interest-rate risk.";
    }

    if (text.includes("etf") || text.includes("mutual fund") || text.includes("fund")) {
        return "ETFs and mutual funds pool many investors' money into a diversified basket of securities. This makes them a simple way to access markets without selecting individual stocks one by one. The main tradeoff is that broader diversification can reduce concentration risk, but it can also limit upside if one opportunity stands out dramatically.";
    }

    if (text.includes("cash flow") || text.includes("income statement") || text.includes("balance sheet") || text.includes("profit margin")) {
        return "Cash flow shows how money moves in and out of a business, while profit margins show how efficiently it converts sales into profit. A company with strong cash flow and healthy margins is often better positioned to invest, manage debt, and weather downturns. Financial statements are useful because they reveal operational quality rather than only headline stock price movements.";
    }

    if (text.includes("recession") || text.includes("gdp") || text.includes("economy") || text.includes("macro")) {
        return "Macro analysis looks at the bigger economic picture, including GDP, employment, inflation, rates, and consumer spending. These factors can influence market sentiment and valuations across sectors. In a recession, risk assets often become more volatile, while defensive sectors and high-quality balance sheets can become more attractive.";
    }

    if (text.includes("what is") || text.includes("explain") || text.includes("how does") || text.includes("why") || text.includes("what are")) {
        return "A strong finance answer usually defines the concept, explains how it is measured, describes what it tells you, and notes its limits. In investing, the point is not to chase one number blindly, but to understand the relationship between risk, return, time, and market conditions before making decisions.";
    }

    return "Finance is about understanding how money grows, how risk is managed, and how markets price uncertainty. A solid answer usually begins with the core concept, shows how it is measured, and then explains the tradeoff it creates. In practice, good financial thinking balances return, risk, time horizon, and diversification instead of relying on a single signal or headline.";
}

async function askOpenAI(prompt) {
    if (!process.env.OPENAI_API_KEY) {
        return buildTutorResponse(prompt);
    }

    try {
        const response = await fetch(
            "https://api.openai.com/v1/responses",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json",

                    Authorization:
                        `Bearer ${process.env.OPENAI_API_KEY}`
                },

                body: JSON.stringify({
                    model: "gpt-5-mini",

                    instructions:
                        "You are the WhatIf AI Finance Tutor. " +
                        "Teach quantitative finance and investing " +
                        "concepts to students in simple language. " +
                        "Explain concepts step by step when useful. " +
                        "Cover technical indicators, risk, " +
                        "portfolio concepts, statistics, " +
                        "backtesting and financial mathematics. " +
                        "Do not guarantee investment returns. " +
                        "Clearly distinguish educational information " +
                        "from personalized financial advice.",

                    input: String(prompt).substring(
                        0,
                        5000
                    )
                })
            }
        );

        if (!response.ok) {
            const text =
                await response.text();

            console.error(
                "OpenAI error:",
                text
            );

            throw new Error(
                "AI service unavailable."
            );
        }

        const data =
            await response.json();

        return (
            data.output_text ||
            data.output?.[0]?.content?.[0]
                ?.text ||
            buildTutorResponse(prompt)
        );
    } catch (error) {
        console.error("Tutor fallback error:", error.message);
        return buildTutorResponse(prompt);
    }
}

app.post(
    "/api/finance-tutor",
    async (req, res) => {
        try {
            const { prompt } = req.body;

            if (
                !prompt ||
                typeof prompt !== "string"
            ) {
                return errorResponse(
                    res,
                    400,
                    "Prompt is required."
                );
            }

            const answer =
                await askOpenAI(prompt);

            return success(res, {
                answer
            });
        } catch (error) {
            console.error(
                "Finance Tutor error:",
                error.message
            );

            return errorResponse(
                res,
                500,
                "AI Finance Tutor is temporarily unavailable."
            );
        }
    }
);

// ============================================================
// RISK ANALYSIS
// ============================================================

function percentile(values, percentileValue) {
    if (!values.length) return 0;

    const sorted = [...values].sort(
        (a, b) => a - b
    );

    const index =
        (percentileValue / 100) *
        (sorted.length - 1);

    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
        return sorted[lower];
    }

    return (
        sorted[lower] +
        (sorted[upper] -
            sorted[lower]) *
            (index - lower)
    );
}

app.post(
    "/api/risk/analyze",
    async (req, res) => {
        try {
            const {
                asset,
                investment = 25000,
                confidence = 95,
                start,
                end
            } = req.body;

            if (!ASSETS[asset]) {
                return errorResponse(
                    res,
                    400,
                    "Unsupported asset."
                );
            }

            if (
                !Number.isFinite(
                    Number(investment)
                ) ||
                Number(investment) <= 0
            ) {
                return errorResponse(
                    res,
                    400,
                    "Investment must be greater than zero."
                );
            }

            if (
                confidence <= 0 ||
                confidence >= 100
            ) {
                return errorResponse(
                    res,
                    400,
                    "Confidence must be between 0 and 100."
                );
            }

            const market =
                await fetchMarketData(
                    asset,
                    start,
                    end
                );

            const prices =
                market.map(
                    (x) => Number(x.close)
                );

            const returns =
                calculateReturns(prices);

            if (returns.length < 10) {
                return errorResponse(
                    res,
                    400,
                    "Not enough historical data."
                );
            }

            const volatility =
                calculateVolatility(
                    returns
                );

            const maxDrawdown =
                calculateDrawdown(prices);

            // Historical VaR:
            // For 95% confidence, use the 5th percentile
            // of historical daily returns.
            const tailProbability =
                100 - confidence;

            const percentileReturn =
                percentile(
                    returns,
                    tailProbability
                );

            const varAmount =
                Math.max(
                    0,
                    -percentileReturn *
                        Number(investment)
                );

            const averageDailyReturn =
                returns.reduce(
                    (a, b) => a + b,
                    0
                ) / returns.length;

            const annualizedExpectedReturn =
                averageDailyReturn * 252;

            return success(res, {
                historicalVolatility:
                    volatility,

                maxDrawdown,

                var:
                    varAmount,

                varPercentage:
                    varAmount /
                    Number(investment),

                expectedReturn:
                    annualizedExpectedReturn,

                dailyExpectedReturn:
                    averageDailyReturn,

                observations:
                    returns.length,

                methodology: {
                    VaR: `${confidence}% historical VaR`,
                    returnFrequency:
                        "daily",
                    volatility:
                        "annualized using sqrt(252)"
                }
            });
        } catch (error) {
            console.error(
                "Risk error:",
                error.message
            );

            return errorResponse(
                res,
                500,
                "Unable to calculate risk."
            );
        }
    }
);

// ============================================================
// PORTFOLIO RISK
// ============================================================

function covariance(a, b) {
    const n = Math.min(
        a.length,
        b.length
    );

    if (n < 2) return 0;

    const x = a.slice(0, n);
    const y = b.slice(0, n);

    const meanX =
        x.reduce(
            (a, b) => a + b,
            0
        ) / n;

    const meanY =
        y.reduce(
            (a, b) => a + b,
            0
        ) / n;

    let total = 0;

    for (let i = 0; i < n; i++) {
        total +=
            (x[i] - meanX) *
            (y[i] - meanY);
    }

    return total / (n - 1);
}

app.post(
    "/api/risk/portfolio",
    async (req, res) => {
        try {
            const {
                investment = 25000,
                weights = {},
                confidence = 95
            } = req.body;

            const assets =
                Object.keys(weights);

            if (!assets.length) {
                return errorResponse(
                    res,
                    400,
                    "Portfolio weights are required."
                );
            }

            let totalWeight = 0;

            for (const asset of assets) {
                if (!ASSETS[asset]) {
                    return errorResponse(
                        res,
                        400,
                        `Unsupported asset: ${asset}`
                    );
                }

                const weight =
                    Number(weights[asset]);

                if (
                    !Number.isFinite(weight) ||
                    weight < 0
                ) {
                    return errorResponse(
                        res,
                        400,
                        "Portfolio weights must be valid positive numbers."
                    );
                }

                totalWeight += weight;
            }

            if (totalWeight <= 0) {
                return errorResponse(
                    res,
                    400,
                    "Total portfolio weight must be greater than zero."
                );
            }

            // Normalize percentage weights.
            const normalized = {};

            for (const asset of assets) {
                normalized[asset] =
                    Number(weights[asset]) /
                    totalWeight;
            }

            const returnSeries = {};

            for (const asset of assets) {
                const data =
                    await fetchMarketData(
                        asset
                    );

                const prices =
                    data.map(
                        (x) =>
                            Number(x.close)
                    );

                returnSeries[asset] =
                    calculateReturns(
                        prices
                    );
            }

            const portfolioReturns = [];

            const minimumLength =
                Math.min(
                    ...assets.map(
                        (asset) =>
                            returnSeries[
                                asset
                            ].length
                    )
                );

            for (
                let i = 0;
                i < minimumLength;
                i++
            ) {
                let dailyReturn = 0;

                for (const asset of assets) {
                    dailyReturn +=
                        normalized[
                            asset
                        ] *
                        returnSeries[
                            asset
                        ][i];
                }

                portfolioReturns.push(
                    dailyReturn
                );
            }

            const portfolioVolatility =
                calculateVolatility(
                    portfolioReturns
                );

            const tailProbability =
                100 - confidence;

            const varReturn =
                percentile(
                    portfolioReturns,
                    tailProbability
                );

            const varAmount =
                Math.max(
                    0,
                    -varReturn *
                        Number(investment)
                );

            const expectedReturn =
                portfolioReturns.reduce(
                    (a, b) => a + b,
                    0
                ) /
                portfolioReturns.length *
                252;

            return success(res, {
                weights: normalized,

                investment:
                    Number(investment),

                volatility:
                    portfolioVolatility,

                var:
                    varAmount,

                varPercentage:
                    varAmount /
                    Number(investment),

                expectedReturn,

                observations:
                    portfolioReturns.length,

                methodology:
                    "Historical portfolio returns using covariance-consistent weighted daily returns."
            });
        } catch (error) {
            console.error(
                "Portfolio risk error:",
                error.message
            );

            return errorResponse(
                res,
                500,
                "Unable to calculate portfolio risk."
            );
        }
    }
);

// ============================================================
// BACKTESTING
// ============================================================

function backtestMovingAverage(
    data,
    initialCapital,
    fastPeriod,
    slowPeriod
) {
    const prices =
        data.map(
            (x) => Number(x.close)
        );

    const fastSMA =
        calculateSMA(
            prices,
            fastPeriod
        );

    const slowSMA =
        calculateSMA(
            prices,
            slowPeriod
        );

    let cash = initialCapital;
    let shares = 0;

    const trades = [];
    const equityCurve = [];

    for (
        let i = 1;
        i < prices.length;
        i++
    ) {
        if (
            fastSMA[i] == null ||
            slowSMA[i] == null ||
            fastSMA[i - 1] == null ||
            slowSMA[i - 1] == null
        ) {
            equityCurve.push({
                date: data[i].date,
                value:
                    cash +
                    shares * prices[i]
            });

            continue;
        }

        const bullishCross =
            fastSMA[i] >
                slowSMA[i] &&
            fastSMA[i - 1] <=
                slowSMA[i - 1];

        const bearishCross =
            fastSMA[i] <
                slowSMA[i] &&
            fastSMA[i - 1] >=
                slowSMA[i - 1];

        // Buy with all available cash
        if (
            bullishCross &&
            shares === 0
        ) {
            shares =
                cash / prices[i];

            cash = 0;

            trades.push({
                date: data[i].date,
                type: "BUY",
                price: prices[i],
                shares
            });
        }

        // Sell entire position
        if (
            bearishCross &&
            shares > 0
        ) {
            cash =
                shares * prices[i];

            trades.push({
                date: data[i].date,
                type: "SELL",
                price: prices[i],
                shares
            });

            shares = 0;
        }

        equityCurve.push({
            date: data[i].date,
            value:
                cash +
                shares * prices[i]
        });
    }

    const finalPrice =
        prices[prices.length - 1];

    const finalCapital =
        cash +
        shares * finalPrice;

    return {
        finalCapital,
        trades,
        equityCurve
    };
}

// ------------------------------------------------------------
// RSI BACKTEST
// ------------------------------------------------------------

function backtestRSI(
    data,
    initialCapital
) {
    const prices =
        data.map(
            (x) => Number(x.close)
        );

    const rsi =
        calculateRSI(
            prices,
            14
        );

    let cash = initialCapital;
    let shares = 0;

    const trades = [];
    const equityCurve = [];

    for (
        let i = 1;
        i < prices.length;
        i++
    ) {
        if (rsi[i] == null) {
            equityCurve.push({
                date: data[i].date,
                value:
                    cash +
                    shares * prices[i]
            });

            continue;
        }

        // Educational RSI rule:
        // RSI <= 30 -> buy
        // RSI >= 70 -> sell
        if (
            rsi[i] <= 30 &&
            shares === 0
        ) {
            shares =
                cash / prices[i];

            cash = 0;

            trades.push({
                date: data[i].date,
                type: "BUY",
                price: prices[i],
                shares,
                rsi: rsi[i]
            });
        }

        if (
            rsi[i] >= 70 &&
            shares > 0
        ) {
            cash =
                shares * prices[i];

            trades.push({
                date: data[i].date,
                type: "SELL",
                price: prices[i],
                shares,
                rsi: rsi[i]
            });

            shares = 0;
        }

        equityCurve.push({
            date: data[i].date,
            value:
                cash +
                shares * prices[i]
        });
    }

    const finalPrice =
        prices[prices.length - 1];

    const finalCapital =
        cash +
        shares * finalPrice;

    return {
        finalCapital,
        trades,
        equityCurve
    };
}

// ------------------------------------------------------------
// BACKTEST API
// ------------------------------------------------------------

app.post(
    "/api/backtest",
    async (req, res) => {
        try {
            const {
                asset,
                strategy =
                    "movingAverageCrossover",
                initialCapital = 10000,
                fastPeriod = 10,
                slowPeriod = 30,
                startDate,
                endDate
            } = req.body;

            if (!ASSETS[asset]) {
                return errorResponse(
                    res,
                    400,
                    "Unsupported asset."
                );
            }

            if (
                !Number.isFinite(
                    Number(initialCapital)
                ) ||
                Number(initialCapital) <= 0
            ) {
                return errorResponse(
                    res,
                    400,
                    "Initial capital must be greater than zero."
                );
            }

            const data =
                await fetchMarketData(
                    asset,
                    startDate,
                    endDate
                );

            if (data.length < 40) {
                return errorResponse(
                    res,
                    400,
                    "Not enough historical data for backtesting."
                );
            }

            let result;

            if (
                strategy ===
                "movingAverageCrossover"
            ) {
                if (
                    fastPeriod >= slowPeriod ||
                    fastPeriod < 2
                ) {
                    return errorResponse(
                        res,
                        400,
                        "Fast period must be smaller than slow period."
                    );
                }

                result =
                    backtestMovingAverage(
                        data,
                        Number(
                            initialCapital
                        ),
                        Number(
                            fastPeriod
                        ),
                        Number(
                            slowPeriod
                        )
                    );
            } else if (
                strategy === "rsi"
            ) {
                result =
                    backtestRSI(
                        data,
                        Number(
                            initialCapital
                        )
                    );
            } else {
                return errorResponse(
                    res,
                    400,
                    "Unsupported strategy."
                );
            }

            const finalCapital =
                result.finalCapital;

            const totalReturn =
                (finalCapital -
                    Number(
                        initialCapital
                    )) /
                Number(initialCapital);

            const equityValues =
                result.equityCurve.map(
                    (x) => x.value
                );

            const maxDrawdown =
                calculateDrawdown(
                    equityValues
                );

            let winningTrades = 0;
            let completedTrades = 0;

            for (
                let i = 1;
                i < result.trades.length;
                i++
            ) {
                const previous =
                    result.trades[i - 1];

                const current =
                    result.trades[i];

                if (
                    previous.type ===
                        "BUY" &&
                    current.type ===
                        "SELL"
                ) {
                    completedTrades++;

                    if (
                        current.price >
                        previous.price
                    ) {
                        winningTrades++;
                    }
                }
            }

            const winRate =
                completedTrades > 0
                    ? winningTrades /
                      completedTrades
                    : 0;

            return success(res, {
                asset,

                strategy,

                initialCapital:
                    Number(initialCapital),

                finalCapital,

                totalReturn,

                totalReturnPercentage:
                    totalReturn * 100,

                maxDrawdown,

                numberOfTrades:
                    result.trades.length,

                completedTrades,

                winRate,

                winRatePercentage:
                    winRate * 100,

                equityCurve:
                    result.equityCurve,

                trades:
                    result.trades,

                disclaimer:
                    "Backtest results are historical simulations and do not guarantee future performance."
            });
        } catch (error) {
            console.error(
                "Backtest error:",
                error.message
            );

            return errorResponse(
                res,
                500,
                "Unable to perform backtest."
            );
        }
    }
);

// ============================================================
// HISTORY
// ============================================================

// ------------------------------------------------------------
// SAVE HISTORY
// ------------------------------------------------------------

app.post(
    "/api/history",
    authMiddleware,
    (req, res) => {
        try {
            const {
                type,
                title,
                data
            } = req.body;

            if (!type || !data) {
                return errorResponse(
                    res,
                    400,
                    "History type and data are required."
                );
            }

            const db = readDatabase();

            const item = {
                id: generateId(),
                userId: req.user.id,
                type,
                title:
                    title ||
                    "WhatIf Analysis",
                data,
                createdAt:
                    new Date().toISOString()
            };

            db.history.push(item);

            writeDatabase(db);

            return success(res, {
                item
            });
        } catch (error) {
            console.error(
                "History save error:",
                error
            );

            return errorResponse(
                res,
                500,
                "Unable to save history."
            );
        }
    }
);

// ------------------------------------------------------------
// GET HISTORY
// ------------------------------------------------------------

app.get(
    "/api/history",
    authMiddleware,
    (req, res) => {
        const db = readDatabase();

        const history =
            db.history
                .filter(
                    (item) =>
                        item.userId ===
                        req.user.id
                )
                .sort(
                    (a, b) =>
                        new Date(b.createdAt) -
                        new Date(a.createdAt)
                );

        return success(res, {
            history
        });
    }
);

// ------------------------------------------------------------
// DELETE HISTORY
// ------------------------------------------------------------

app.delete(
    "/api/history/:id",
    authMiddleware,
    (req, res) => {
        const db = readDatabase();

        const index =
            db.history.findIndex(
                (item) =>
                    item.id ===
                        req.params.id &&
                    item.userId ===
                        req.user.id
            );

        if (index === -1) {
            return errorResponse(
                res,
                404,
                "History item not found."
            );
        }

        db.history.splice(index, 1);

        writeDatabase(db);

        return success(res, {
            message:
                "History item deleted."
        });
    }
);

// ============================================================
// DASHBOARD
// ============================================================

app.get(
    "/api/dashboard",
    authMiddleware,
    (req, res) => {
        const db = readDatabase();

        const userHistory =
            db.history.filter(
                (item) =>
                    item.userId ===
                    req.user.id
            );

        return success(res, {
            user: req.user,

            totalAnalyses:
                userHistory.length,

            recentHistory:
                userHistory
                    .sort(
                        (a, b) =>
                            new Date(
                                b.createdAt
                            ) -
                            new Date(
                                a.createdAt
                            )
                    )
                    .slice(0, 10)
        });
    }
);

// ============================================================
// INDICATOR API
// ============================================================

app.post(
    "/api/indicators",
    async (req, res) => {
        try {
            const {
                asset,
                period = 14
            } = req.body;

            if (!ASSETS[asset]) {
                return errorResponse(
                    res,
                    400,
                    "Unsupported asset."
                );
            }

            const market =
                await fetchMarketData(
                    asset
                );

            const prices =
                market.map(
                    (x) => Number(x.close)
                );

            const sma =
                calculateSMA(
                    prices,
                    Number(period)
                );

            const rsi =
                calculateRSI(
                    prices,
                    Number(period)
                );

            const macd =
                calculateMACD(
                    prices
                );

            return success(res, {
                asset,
                data: market.map(
                    (item, index) => ({
                        ...item,
                        sma:
                            sma[index],
                        rsi:
                            rsi[index],
                        macd:
                            macd.macd[index],
                        signal:
                            macd.signal[index]
                    })
                )
            });
        } catch (error) {
            console.error(
                "Indicator error:",
                error.message
            );

            return errorResponse(
                res,
                500,
                "Unable to calculate indicators."
            );
        }
    }
);

// ============================================================
// SERVE FRONTEND FROM THE FRONT_END FOLDER
// ============================================================

const FRONTEND_DIR = path.join(
    __dirname,
    "..",
    "front_end"
);

app.use(
    express.static(FRONTEND_DIR)
);

app.get("/", (req, res) => {
    const dashboardPath = path.join(
        FRONTEND_DIR,
        "jarvis8.html"
    );

    if (fs.existsSync(dashboardPath)) {
        return res.sendFile(dashboardPath);
    }

    const indexPath = path.join(
        FRONTEND_DIR,
        "index.html"
    );

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    return res.send(
        "Frontend not found. Please ensure the front_end folder contains the app entry page."
    );
});

app.get(/^(?!\/api).*$/, (req, res, next) => {
    if (req.path.startsWith("/api")) {
        return next();
    }

    const requestedPath =
        req.path === "/"
            ? "jarvis8.html"
            : req.path.replace(/^\//, "");

    const filePath = path.join(
        FRONTEND_DIR,
        requestedPath
    );

    if (
        fs.existsSync(filePath) &&
        fs.statSync(filePath).isFile()
    ) {
        return res.sendFile(filePath);
    }

    const fallbackPath = path.join(
        FRONTEND_DIR,
        "jarvis8.html"
    );

    if (fs.existsSync(fallbackPath)) {
        return res.sendFile(fallbackPath);
    }

    next();
});

// ------------------------------------------------------------
// 404 API
// ------------------------------------------------------------

app.use((req, res) => {
    if (req.path.startsWith("/api")) {
        return errorResponse(
            res,
            404,
            "API endpoint not found."
        );
    }

    res.status(404).send(
        "WhatIf page not found."
    );
});

// ------------------------------------------------------------
// ERROR HANDLER
// ------------------------------------------------------------

app.use(
    (err, req, res, next) => {
        console.error(
            "Server error:",
            err
        );

        return errorResponse(
            res,
            500,
            "Internal server error."
        );
    }
);

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(PORT, () => {
    console.log(
        "=========================================="
    );

    console.log(
        "       WHATIF BACKEND RUNNING"
    );

    console.log(
        "=========================================="
    );

    console.log(
        `Server: http://localhost:${PORT}`
    );

    console.log(
        `Health: http://localhost:${PORT}/api/health`
    );

    console.log(
        "=========================================="
    );
});