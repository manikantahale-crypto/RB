/** Sleep N ms then exit 0 — used to stagger dev services on Windows. */
const ms = Math.max(0, Number(process.argv[2]) || 5000);
setTimeout(() => process.exit(0), ms);
