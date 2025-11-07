import React from 'react';
import { motion } from 'framer-motion';
import { X, Heart, Bell } from 'lucide-react';

export default function ClientWelcomeBanner({ onClose }) {
  const containerVariants = {
    hidden: { y: '-100%', opacity: 0 },
    visible: { y: '1rem', opacity: 1, transition: { type: 'spring', stiffness: 100, damping: 15 } },
    exit: { y: '-100%', opacity: 0, transition: { duration: 0.3 } }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="fixed top-0 left-4 right-4 bg-black/95 backdrop-blur-md text-white rounded-b-3xl shadow-2xl z-40"
      style={{ paddingTop: '5rem' }} // Space for the top nav bar
    >
      <button onClick={onClose} className="absolute top-20 right-5 text-gray-400 hover:text-white transition-colors">
        <X className="w-5 h-5" />
      </button>

      <div className="p-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Bell className="w-6 h-6 text-yellow-400" />
          <h2 className="text-2xl font-bold">עדכונים חשובים</h2>
        </div>
        
        <div className="space-y-4 text-white/90 text-sm max-w-md mx-auto leading-relaxed">
          <p>
            אנו מבקשים להגיע בזמן על מנת שנוכל לייעל את זמני ההמתנה במספרה לטובת התייעלות ושיפור החוויה.
          </p>
          <p className="font-semibold">
            אין לקבוע תור ללא הגעה, יש לבטל דרך האפליקציה עד 24 שעות לפני התור.
          </p>
          <p>
            לקוח שיקבע תור ולא יגיע ללא הודעה מראש ייאלץ לשלם על התור במלואו.
          </p>
          <p className="flex items-center justify-center gap-2 pt-2">
            אוהבים, פמיליה <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
          </p>
        </div>
      </div>
    </motion.div>
  );
}