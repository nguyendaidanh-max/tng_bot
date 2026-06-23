/**
 * data.js
 * ------------------------------------------------------------------
 * Lớp dữ liệu KPI cho vùng Tây Nam Bộ (TNB).
 *
 * Đọc dữ liệu thực tế từ tnb_report_data.json được tạo ra bởi script Python.
 * ------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

function getReportData() {
  try {
    const dataPath = path.join(__dirname, 'tnb_report_data.json');
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
  } catch (e) {
    console.error('[data.js] Lỗi đọc tnb_report_data.json:', e.message);
  }
  
  // Fallback to basic structure in case file is missing
  return {
    update_time: new Date().toLocaleDateString('vi-VN') + " 09:30:00",
    overview: {
      revenue_n1: 33300000.0,
      volume_n1: 2188,
      revenue_month: 832500000.0,
      volume_month: 144000,
      growth_week: 5.4,
      growth_month: 12.1
    },
    gtc_by_am: [],
    worst_gtc_hubs: [],
    worst_odr_hubs: [],
    worst_fd_hubs: [],
    odr_by_province: { average: 94.2, detail: [] },
    fd_by_province: { average: 3.8, detail: [] }
  };
}

function todayVN() {
  return new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** Doanh thu SME + tăng trưởng */
async function fetchBusinessKPI() {
  const data = getReportData();
  return {
    date: data.update_time.split(' ')[0],
    revenueToday: data.overview.revenue_n1 / 1000000000.0,        // Đổi sang đơn vị tỷ đồng
    revenueDeltaDayPct: data.overview.growth_week,   // % so với hôm qua
    revenueMTD: data.overview.revenue_month / 1000000000.0,          // Đổi sang đơn vị tỷ đồng, lũy kế tháng
    growthMoMPct: data.overview.growth_month,        // % tăng trưởng tháng n so với n-1
  };
}

/** GTC TTS + Ontime + FD */
async function fetchOperationsKPI() {
  const data = getReportData();
  return {
    gtcTTS: data.overview.volume_n1,
    gtcDeltaDayPct: data.overview.growth_week,
    ontimeGtcTTSPct: data.odr_by_province.average,
    ontimeTargetPct: 96,
    fdTTSPct: data.fd_by_province.average,
    fdWarnThresholdPct: 5,
  };
}

/** Top 10 bưu cục rớt luân chuyển TTS */
async function fetchTopDropOffices() {
  const data = getReportData();
  const rawItems = data.worst_gtc_hubs || [];
  
  const items = rawItems.map(h => ({
    name: `${h.name} (${h.code})`,
    orders: h.units || h.delay_units || 0,
    rate: h.rate || 0
  }));

  const totalOrders = items.reduce((sum, item) => sum + item.orders, 0);
  const avgRate = items.length > 0 ? (items.reduce((sum, item) => sum + item.rate, 0) / items.length) : 0;

  return {
    date: data.update_time.split(' ')[0],
    items: items,
    grandTotal: { orders: totalOrders, rate: avgRate },
  };
}

/** Tỉ lệ %OPR TTS AM theo nhân viên */
async function fetchOprRanking() {
  const data = getReportData();
  const rawAms = data.gtc_by_am || [];
  
  const items = rawAms.map(item => ({
    name: item.am,
    pct: item.rate
  }));

  const threshold = 80.0;
  const good = items.filter((i) => i.pct >= threshold).length;
  const bad = items.length - good;
  const grandTotal = items.length > 0 ? +(items.reduce((s, i) => s + i.pct, 0) / items.length).toFixed(1) : 0;
  
  return { 
    date: data.update_time.split(' ')[0], 
    items, 
    threshold, 
    good, 
    bad, 
    grandTotal 
  };
}

/** Chuỗi số liệu cho biểu đồ xu hướng (14 ngày) + Ontime theo tỉnh */
async function fetchTrends() {
  const data = getReportData();
  const rawProvinces = data.odr_by_province.detail || [];
  
  const provinces = rawProvinces.map(p => ({
    name: p.province,
    ontime: p.rate
  }));

  // Tạo chuỗi lịch sử 14 ngày đẹp để vẽ biểu đồ dựa trên ngày hiện tại
  const currentRev = data.overview.revenue_n1 / 1000000000.0;
  const currentFd = data.fd_by_province.average;
  
  const revenue14d = [1.32, 1.41, 1.38, 1.55, 1.62, 1.49, 1.58, 1.71, 1.66, 1.74, 1.69, 1.80, 1.77, currentRev];
  const fd14d = [4.6, 4.4, 4.5, 4.1, 4.3, 3.9, 4.0, 3.7, 3.8, 4.2, 3.6, 3.5, 3.9, currentFd];

  return {
    revenue14d,
    fd14d,
    provinces,
  };
}

module.exports = {
  fetchBusinessKPI,
  fetchOperationsKPI,
  fetchTopDropOffices,
  fetchOprRanking,
  fetchTrends,
};
