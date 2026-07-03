/**
 * One-time seed script: creates the default company account.
 * Run once: node scripts/seed-company.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const MONGO_URI = 'mongodb://soham:soham123@ac-76zcm22-shard-00-00.tonybht.mongodb.net:27017,ac-76zcm22-shard-00-01.tonybht.mongodb.net:27017,ac-76zcm22-shard-00-02.tonybht.mongodb.net:27017/?ssl=true&replicaSet=atlas-ys4rdk-shard-0&authSource=admin&appName=prepwise';

const companySchema = new mongoose.Schema({
    name: String,
    email: String,
    company_add: String,
    phone: String,
    username: { type: String, unique: true },
    password: String,
});

const Company = mongoose.model('Company', companySchema);

async function seed() {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const existing = await Company.findOne({ username: 'company' });
    if (existing) {
        console.log('Company account already exists — skipping.');
        await mongoose.disconnect();
        return;
    }

    const hashedPassword = await bcrypt.hash('company123', 10);
    await Company.create({
        name: 'Default Company',
        username: 'company',
        password: hashedPassword,
    });

    console.log('Company account created: username=company, password=company123');
    await mongoose.disconnect();
}

seed().catch(err => { console.error(err); process.exit(1); });
