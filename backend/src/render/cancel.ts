export class RenderCancelled extends Error {
  constructor() {
    super('render cancelled');
    this.name = 'RenderCancelled';
  }
}
