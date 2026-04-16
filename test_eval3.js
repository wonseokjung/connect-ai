const axios = require('axios');
axios.get('http://127.0.0.1:4825/ping').then(r => console.log(r.data)).catch(e => console.error(e));
