// Simple test to verify console output works
console.log('═══════════════════════════════════════════════════════════');
console.log('TEST: Console.log is working!');
console.log('If you see this, console output is working.');
console.log('Time:', new Date().toISOString());
console.log('═══════════════════════════════════════════════════════════');

// Test all console methods
console.log('LOG: This is a log message');
console.info('INFO: This is an info message');
console.warn('WARN: This is a warning message');
console.error('ERROR: This is an error message');

// Force output
process.stdout.write('STDOUT: Direct write to stdout\n');
process.stderr.write('STDERR: Direct write to stderr\n');

console.log('\n✅ If you see all of the above, console is working!\n');

