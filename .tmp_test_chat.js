const fn = require('./netlify/functions/chat.js').handler;
(async ()=>{
  const event = { httpMethod:'POST', headers:{}, body: JSON.stringify({message:'Hello from local test'}) };
  try {
    const res = await fn(event);
    console.log('=== FUNCTION RESPONSE ===');
    console.log(res);
  } catch (e) {
    console.error('ERROR INVOKING FUNCTION', e);
  }
})();
