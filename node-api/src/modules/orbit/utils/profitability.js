/**
 * Profitability Calculation for Placed Candidates in ORBIT (CommonJS)
 *
 * Total Profit = Completed Months * Monthly Profit + Prorated Partial Months
 * Handles leap years, month boundaries, same-month starts, and future dates.
 *
 * @param {string|Date} placedDateStr - Placement start date (e.g. '2026-01-15')
 * @param {number} monthlyProfit - Monthly profit amount (e.g. 2500)
 * @param {Date} [asOfDate] - Current comparison date (defaults to today)
 * @returns {number} Total profit rounded to 2 decimal places
 */
function calculateTotalProfitTillToday(placedDateStr, monthlyProfit, asOfDate = new Date()) {
  const profit = parseFloat(monthlyProfit);
  if (!placedDateStr || isNaN(profit) || profit <= 0) return 0;

  const placed = new Date(placedDateStr);
  const today = new Date(asOfDate);

  if (isNaN(placed.getTime()) || isNaN(today.getTime())) return 0;

  const placedYear = placed.getFullYear();
  const placedMonth = placed.getMonth();
  const placedDay = placed.getDate();

  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();

  const placedTime = new Date(placedYear, placedMonth, placedDay).getTime();
  const todayTime = new Date(todayYear, todayMonth, todayDay).getTime();

  // If placement starts in future
  if (todayTime < placedTime) return 0;

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();

  // Case 1: Placed in the same calendar month and year as today
  if (placedYear === todayYear && placedMonth === todayMonth) {
    const totalDays = getDaysInMonth(placedYear, placedMonth);
    const activeDays = todayDay - placedDay + 1; // inclusive of start day and current day
    return parseFloat(((profit * activeDays) / totalDays).toFixed(2));
  }

  let totalProfit = 0;
  let currentYear = placedYear;
  let currentMonth = placedMonth;

  while (
    currentYear < todayYear ||
    (currentYear === todayYear && currentMonth <= todayMonth)
  ) {
    const totalDaysInMonth = getDaysInMonth(currentYear, currentMonth);

    if (currentYear === placedYear && currentMonth === placedMonth) {
      // First month: active from placedDay through end of that month
      const activeDays = totalDaysInMonth - placedDay + 1;
      totalProfit += (profit * activeDays) / totalDaysInMonth;
    } else if (currentYear === todayYear && currentMonth === todayMonth) {
      // Current month: active from 1st of month through todayDay
      const activeDays = todayDay;
      totalProfit += (profit * activeDays) / totalDaysInMonth;
    } else {
      // Full intermediate calendar month
      totalProfit += profit;
    }

    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }

  return parseFloat(totalProfit.toFixed(2));
}

module.exports = {
  calculateTotalProfitTillToday,
};
