// Application bootstrap. Wires platform → sim → render. Fleshed out across Phase 1-2.

function bootstrap(): void {
  const app = document.getElementById('app');
  if (app === null) {
    throw new Error('missing #app root element');
  }
}

bootstrap();
