const fs = require('fs');
const path = require('path');
const db = require('../db');

/**
 * Neutralizes CSV formula injection characters (=, +, -, @)
 * and safely escapes double quotes.
 */
function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val).trim();
  if (/^[=\+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * SAP Integration Service
 * Generates outbound data packets for Asset Creation in SAP
 */
async function generateSAPAssetPacket(requestId) {
  try {
    const [rows] = await db.query(`
      SELECT cr.*, me.name as requester_name, ag.name as asset_group_name, at.asset_name as asset_name_type,
             at.sap_asset_class, at.block_key, at.procurement_indicator
      FROM capex_request cr
      LEFT JOIN capex_master_employee me ON me.emp_no = cr.emp_no
      LEFT JOIN capex_master_asset_type at ON at.id = cr.asset_type
      LEFT JOIN capex_master_asset_group ag ON ag.id = at.asset_group
      WHERE cr.id = ?
    `, [requestId]);

    if (!rows.length) throw new Error('Request not found');
    const req = rows[0];

    // SAP Data Packet Generation (CSV)
    let csvContent = Object.keys({
      CAPEX_NO: '', ASSET_CLASS: '', COMPANY_CODE: '', PLANT: '', COST_CENTER: '',
      ASSET_DESCRIPTION: '', QUANTITY: '', AMOUNT: '', VENDOR: '', MANUFACTURER: '',
      REQUISITIONER: '', SANCTION_NO: ''
    }).join(',') + '\n';

    // Fetch items for multi-asset
    const [items] = await db.query('SELECT * FROM capex_request_items WHERE capex_request_id = ?', [requestId]);

    if(items.length > 0) {
      items.forEach(item => {
        const itemPacket = [
          req.capex_no,
          req.sap_asset_class || 'DUMMY',
          '1000',
          req.location || '1001',
          req.costcentre || '9999',
          item.asset_name,
          item.asset_quantity,
          item.amount_ext_gst,
          req.sap_vender_code1 || '',
          req.manufacturer || '',
          req.emp_no,
          req.sanction_no || ''
        ];
        csvContent += itemPacket.map(escapeCsvField).join(',') + '\n';
      });
    } else {
        const packet = [
          req.capex_no,
          req.sap_asset_class || 'DUMMY',
          '1000',
          req.location || '1001',
          req.costcentre || '9999',
          req.asset_name,
          req.asset_quantity,
          req.approve_amount || req.amount_ext_gst,
          req.sap_vender_code1 || '',
          req.manufacturer || '',
          req.emp_no,
          req.sanction_no || ''
        ];
        csvContent += packet.map(escapeCsvField).join(',') + '\n';
    }
    
    // In a real scenario, we'd write to an FTP folder or call an EAI middleware
    const outboundDir = path.join(__dirname, '../outbound_sap');
    if (!fs.existsSync(outboundDir)) fs.mkdirSync(outboundDir, { recursive: true });
    
    const fileName = `SAP_ASSET_${req.capex_no}_${Date.now()}.csv`;
    fs.writeFileSync(path.join(outboundDir, fileName), csvContent);

    // Update request with SAP Status
    await db.query(
      "UPDATE capex_request SET sap_status = 'Sent', sap_packet_generated_at = NOW() WHERE id = ?",
      [requestId]
    );

    return { success: true, fileName };
  } catch (err) {
    console.error('SAP Generation Error:', err);
    throw err;
  }
}

module.exports = { generateSAPAssetPacket };
