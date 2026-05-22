const fs = require('fs');
const path = require('path');
const db = require('../db');

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
        const itemPacket = {
          CAPEX_NO: req.capex_no,
          ASSET_CLASS: req.sap_asset_class || 'DUMMY',
          COMPANY_CODE: '1000',
          PLANT: req.location || '1001',
          COST_CENTER: req.costcentre || '9999',
          ASSET_DESCRIPTION: item.asset_name,
          QUANTITY: item.asset_quantity,
          AMOUNT: item.amount_ext_gst,
          VENDOR: req.sap_vender_code1 || '',
          MANUFACTURER: req.manufacturer || '',
          REQUISITIONER: req.emp_no,
          SANCTION_NO: req.sanction_no || '',
        };
        csvContent += Object.values(itemPacket).join(',') + '\n';
      });
    } else {
        const packet = {
          CAPEX_NO: req.capex_no,
          ASSET_CLASS: req.sap_asset_class || 'DUMMY',
          COMPANY_CODE: '1000',
          PLANT: req.location || '1001',
          COST_CENTER: req.costcentre || '9999',
          ASSET_DESCRIPTION: req.asset_name,
          QUANTITY: req.asset_quantity,
          AMOUNT: req.approve_amount || req.amount_ext_gst,
          VENDOR: req.sap_vender_code1 || '',
          MANUFACTURER: req.manufacturer || '',
          REQUISITIONER: req.emp_no,
          SANCTION_NO: req.sanction_no || '',
        };
        csvContent += Object.values(packet).join(',');
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
