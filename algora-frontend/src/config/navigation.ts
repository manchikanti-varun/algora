export const navigation = {
  student: [
    'Overview',
    'My Courses',
    'Learning Days',
    'Problems',
    'Progress',
    'Attendance',
    'My QR',
    'Profile',
  ],
  admin: [
    'Overview',
    'Courses',
    'Batches',
    'Students',
    'Attendance',
    'Reports',
    'Profile',
  ],
  'super-admin': [
    'Overview',
    'Colleges',
    'Admin Approvals',
    'Admin Management',
    'Students',
    'Courses',
    'Reports',
    'Audit Logs',
    'Settings',
  ],
} as const;
export type PreviewRole = keyof typeof navigation;
