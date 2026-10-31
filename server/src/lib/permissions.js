// The single source of truth for what each role may do. Routes enforce these and
// the client receives the same list to shape navigation.
const CLINICIANS = ['doctor', 'nurse']
const FRONT_DESK = ['receptionist']

const matrix = {
  'dashboard:read': ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician', 'accountant'],

  'patients:read': ['admin', ...CLINICIANS, ...FRONT_DESK, 'pharmacist', 'lab_technician', 'accountant'],
  'patients:write': ['admin', ...CLINICIANS, ...FRONT_DESK],

  'appointments:read': ['admin', ...CLINICIANS, ...FRONT_DESK],
  'appointments:write': ['admin', 'doctor', ...FRONT_DESK],

  // Full clinical notes are restricted to the care team.
  'clinical:read': ['admin', ...CLINICIANS],
  'clinical:write': ['doctor'],
  'vitals:write': CLINICIANS,

  'prescriptions:read': ['admin', ...CLINICIANS, 'pharmacist'],
  'prescriptions:write': ['doctor'],
  'pharmacy:read': ['admin', 'pharmacist', 'doctor', 'nurse'],
  'pharmacy:write': ['admin', 'pharmacist'],
  'pharmacy:dispense': ['pharmacist'],

  'lab:read': ['admin', ...CLINICIANS, 'lab_technician'],
  'lab:order': ['doctor'],
  'lab:process': ['lab_technician'],
  'lab:catalog': ['admin', 'lab_technician'],

  'ipd:read': ['admin', ...CLINICIANS, ...FRONT_DESK],
  'ipd:admit': ['doctor', ...FRONT_DESK, 'admin'],
  'ipd:care': CLINICIANS,
  'ipd:discharge': ['doctor'],
  'ipd:config': ['admin'],

  'er:read': ['admin', ...CLINICIANS, ...FRONT_DESK],
  'er:write': ['admin', ...CLINICIANS, ...FRONT_DESK],

  'surgery:read': ['admin', ...CLINICIANS, ...FRONT_DESK],
  'surgery:write': ['admin', 'doctor'],

  'blood:read': ['admin', ...CLINICIANS, 'lab_technician'],
  'blood:write': ['admin', 'lab_technician'],

  'ambulance:read': ['admin', ...CLINICIANS, ...FRONT_DESK],
  'ambulance:write': ['admin', ...FRONT_DESK],

  'inventory:read': ['admin', 'nurse', 'pharmacist'],
  'inventory:write': ['admin', 'pharmacist', 'nurse'],

  'billing:read': ['admin', 'accountant', ...FRONT_DESK],
  'billing:write': ['admin', 'accountant', ...FRONT_DESK],
  'billing:void': ['admin', 'accountant'],
  'claims:write': ['admin', 'accountant'],
  'services:write': ['admin', 'accountant'],

  'staff:read': ['admin'],
  'staff:write': ['admin'],
  'departments:write': ['admin'],
  'schedules:write': ['admin', ...FRONT_DESK],
  'hr:manage': ['admin'],

  'reports:read': ['admin', 'accountant'],
  'audit:read': ['admin'],
  'settings:write': ['admin'],
}

export const permissionsFor = (role) => Object.keys(matrix).filter((key) => matrix[key].includes(role))
export const can = (role, permission) => Boolean(matrix[permission]?.includes(role))
