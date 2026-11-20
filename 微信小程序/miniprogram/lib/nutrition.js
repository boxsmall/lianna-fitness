// Largest-remainder allocation: displayed meals add up exactly without negative residuals.
function allocate(total, ratios) {
  const target = Math.round(total), raw = ratios.map(r=>target*r/100), values = raw.map(Math.floor);
  const order = raw.map((v,i)=>({i,f:v-values[i]})).sort((a,b)=>b.f-a.f || a.i-b.i);
  for(let n=target-values.reduce((s,v)=>s+v,0), i=0; i<n; i++) values[order[i % order.length].i]++;
  return values;
}
module.exports = { allocate };
