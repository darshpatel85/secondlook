import { EventEmitter } from "node:events";

export type ReviewEvent = { type: string; at?: number } & Record<string, unknown>;

const anyReview = Symbol("any review");

class ReviewBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(reviewId: string, event: ReviewEvent): void {
    const stamped = { ...event, at: Date.now() };
    this.emitter.emit(reviewId, stamped);
    this.emitter.emit(anyReview, reviewId, stamped);
  }

  subscribeAll(listener: (reviewId: string, event: ReviewEvent) => void): () => void {
    this.emitter.on(anyReview, listener);
    return () => this.emitter.off(anyReview, listener);
  }

  subscribe(reviewId: string, listener: (event: ReviewEvent) => void): () => void {
    this.emitter.on(reviewId, listener);
    return () => this.emitter.off(reviewId, listener);
  }
}

export const bus = new ReviewBus();
