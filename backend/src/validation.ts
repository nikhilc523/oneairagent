import { DataStore } from './data/store';
import { Booking } from './types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  booking?: Booking;
}

export class ProposalValidator {
  constructor(private store: DataStore) {}

  async validateRebook(
    bookingRef: string,
    newDate: string,
    newCity?: string,
  ): Promise<ValidationResult> {
    const booking = await this.store.getBooking(bookingRef);

    if (!booking) {
      return { valid: false, error: `Booking ${bookingRef} not found.` };
    }
    if (booking.status === 'cancelled') {
      return { valid: false, error: `Booking ${bookingRef} is already cancelled.` };
    }
    if (booking.status === 'completed') {
      return { valid: false, error: `Booking ${bookingRef} has already been completed (past travel).` };
    }

    const newDepartDate = new Date(newDate);
    if (isNaN(newDepartDate.getTime())) {
      return { valid: false, error: `Invalid date: ${newDate}.` };
    }
    if (newDepartDate <= new Date()) {
      return { valid: false, error: `New date ${newDate} is in the past.` };
    }

    const originalDepart = new Date(booking.departAt);
    const hoursUntilDepart = (originalDepart.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilDepart < 2) {
      return { valid: false, error: 'Changes must be made at least 2 hours before departure.' };
    }

    return { valid: true, booking };
  }

  async validateRefund(bookingRef: string): Promise<ValidationResult> {
    const booking = await this.store.getBooking(bookingRef);

    if (!booking) {
      return { valid: false, error: `Booking ${bookingRef} not found.` };
    }
    if (booking.status === 'cancelled') {
      return { valid: false, error: `Booking ${bookingRef} is already cancelled.` };
    }
    if (booking.status === 'completed') {
      return { valid: false, error: `Booking ${bookingRef} has already been completed.` };
    }

    return { valid: true, booking };
  }

  computeRefund(booking: Booking): { refundAmount: number; fee: number; reason: string } {
    const hoursUntilDepart = (new Date(booking.departAt).getTime() - Date.now()) / (1000 * 60 * 60);

    if (booking.refundable) {
      if (hoursUntilDepart > 24) {
        const fee = 50;
        return {
          refundAmount: booking.price - fee,
          fee,
          reason: `Refundable ticket cancelled >24h before departure. Full refund minus $${fee} processing fee.`,
        };
      } else {
        const refundAmount = booking.price * 0.8;
        const fee = booking.price - refundAmount;
        return {
          refundAmount,
          fee,
          reason: `Refundable ticket cancelled <24h before departure. 80% refund ($${refundAmount.toFixed(2)}).`,
        };
      }
    } else {
      if (hoursUntilDepart > 24) {
        const fee = 150;
        const credit = booking.price - fee;
        return {
          refundAmount: 0,
          fee,
          reason: `Non-refundable ticket. No cash refund. Travel credit of $${credit.toFixed(2)} issued (fare minus $${fee} change fee), valid 12 months.`,
        };
      } else {
        return {
          refundAmount: 0,
          fee: booking.price,
          reason: 'Non-refundable ticket cancelled <24h before departure. No refund or credit available.',
        };
      }
    }
  }

  computeRebookFee(booking: Booking): { fee: number; reason: string } {
    if (booking.refundable) {
      return { fee: 0, reason: 'Refundable ticket — free date/time change.' };
    }
    return { fee: 150, reason: 'Non-refundable ticket — $150 change fee applies, plus any fare difference.' };
  }
}
