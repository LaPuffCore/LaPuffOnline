// Simple calibration script for red multiplier using Gaussian kernel approximation
// Node.js script

function analytic(R0, s, thr, w0=1) {
  const r0 = R0 * Math.sqrt(-Math.log(thr / w0));
  const R1 = s * R0;
  const r1 = r0 / 2; // target radius is half for 1/4 area
  const w1 = thr * Math.exp(Math.pow(r1 / R1, 2));
  return { R0, R1, r0, r1, w0, w1, multiplier: w1 / w0 };
}

function numericVerify(R0, s, thr, w1) {
  const R1 = s * R0;
  // find radius where density >= thr for single point kernel
  // density(r) = w1 * exp(-(r/R1)^2)
  // analytic inverse: r = R1 * sqrt(-ln(thr/w1)) if thr/w1 <=1
  if (thr / w1 > 1) {
    return { valid: false, message: 'thr > w1, no solution (density max < thr)' };
  }
  const r = R1 * Math.sqrt(-Math.log(thr / w1));
  return { valid: true, computedRadius: r };
}

function run() {
  const R0 = 100; // px
  const s = 2; // scale factor
  const w0 = 1;
  const thr = 0.88; // using heatmap-density threshold for red (from code)

  console.log('Calibration input: R0=' + R0 + ' s=' + s + ' thr=' + thr + ' w0=' + w0);
  const a = analytic(R0, s, thr, w0);
  console.log('\nAnalytic results:');
  console.log(' original red radius r0 =', a.r0.toFixed(4), 'px (R0=', a.R0, ')');
  console.log(' target red radius r1 = r0/2 =', a.r1.toFixed(4), 'px');
  console.log(' scaled kernel radius R1 =', a.R1, 'px');
  console.log(' required new weight w1 =', a.w1.toFixed(6));
  console.log(' multiplier w1/w0 =', a.multiplier.toFixed(6));

  console.log('\nNumeric verification (analytic inverse):');
  const v = numericVerify(R0, s, thr, a.w1);
  if (v.valid) console.log(' computed radius at thr with w1 =', v.computedRadius.toFixed(6), 'px (should equal target r1=', a.r1.toFixed(6), ')');
  else console.log(' verification failed:', v.message);

  console.log('\nInterpretation:');
  console.log(' If kernel is Gaussian with density = w * exp(-(r/R)^2),');
  console.log(' then reducing weight to multiplier above will shrink red radial boundary to half, giving 1/4 area.');

  console.log('\nEdge cases and caveats:');
  console.log(' - MapLibre uses its own kernel/normalization; this is an approximation.');
  console.log(' - Multiple nearby points and overlapping kernels change effective density nonlinearly.');
  console.log(' - Use this as starting multiplier, then refine with in-situ sampling of actual heatmap-density values.');
}

run();
