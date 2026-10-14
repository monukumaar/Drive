const config = require('../config');
const LocalStorage = require('./local');

module.exports = new LocalStorage(config.storageDir);
