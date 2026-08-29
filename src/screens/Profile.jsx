// src/screens/Profile.jsx
import React from "react";
import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "../utils/firebase";
import { signOut } from "firebase/auth";

export default function Profile({ userProfile, setUserProfile, storeSettings, setStoreSettings, setPopupModal }) {
  
  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem("uid");
    window.location.href = "/login";
  };

  return (
    <div style={{ padding: "40px", maxWidth: "600px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ backgroundColor: "#fff", borderRadius: "24px", padding: "30px", boxShadow: "0 4px 20px rgba(0,0,0,0.06)", border: "1px solid #e2e8f0", display: "flex", flexDirection: "column", gap: "24px" }}>
        
        {/* Hidden File Input for DP Upload */}
{/* Hidden File Input for DP Upload */}
        <input 
          type="file" 
          id="profileDpInput" 
          accept="image/*" 
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files[0];
            if (file) {
              const reader = new FileReader();
              reader.readAsDataURL(file);
              reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                  const canvas = document.createElement('canvas');
                  let width = img.width;
                  let height = img.height;
                  const maxWidth = 300;
                  const maxHeight = 300;

                  if (width > height) {
                    if (width > maxWidth) {
                      height = Math.round((height * maxWidth) / width);
                      width = maxWidth;
                    }
                  } else {
                    if (height > maxHeight) {
                      width = Math.round((width * maxHeight) / height);
                      height = maxHeight;
                    }
                  }

                  canvas.width = width;
                  canvas.height = height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0, width, height);
                  
                  // Compress to smaller JPEG base64 string
                  const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                  setUserProfile({ ...userProfile, profileImage: compressedDataUrl });
                };
              };
            }
          }}
        />

        {/* Centered Circular DP with Green Camera Icon Badge */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
          <div 
            onClick={() => document.getElementById("profileDpInput").click()}
            style={{ 
              position: "relative", 
              width: "95px", 
              height: "95px", 
              borderRadius: "50%", 
              overflow: "hidden", 
              backgroundColor: "#6366f1", 
              boxShadow: "0 6px 16px rgba(99, 102, 241, 0.3)",
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              cursor: "pointer"
            }}
            title="Click to change profile picture"
          >
            {userProfile.profileImage ? (
              <img src={userProfile.profileImage} alt="Profile DP" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <span style={{ fontSize: "42px", color: "#fff" }}>👤</span>
            )}

            {/* Green Camera Icon Badge */}
            <div style={{
              position: "absolute",
              bottom: "3px",
              right: "3px",
              width: "30px",
              height: "30px",
              backgroundColor: "#10b981",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
              color: "#fff",
              fontSize: "13px",
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)"
            }}>
              📷
            </div>
          </div>
          <span style={{ fontSize: "14px", fontWeight: "800", color: "#1e293b" }}>Profile Picture</span>
        </div>

        {/* Input Fields Container */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          
          {/* Name Input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#64748b" }}>Admin Name</label>
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "4px 14px", display: "flex", alignItems: "center" }}>
              <input 
                type="text" 
                value={userProfile.name} 
                onChange={(e) => setUserProfile({ ...userProfile, name: e.target.value })}
                placeholder="Name"
                style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none" }}
              />
            </div>
          </div>

          {/* Store Name Input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#64748b" }}>Store Name</label>
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "4px 14px", display: "flex", alignItems: "center" }}>
              <input 
                type="text" 
                value={userProfile.storeName} 
                onChange={(e) => setUserProfile({ ...userProfile, storeName: e.target.value })}
                placeholder="Store Name"
                style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none" }}
              />
            </div>
          </div>

          {/* Email Input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#64748b" }}>Email Address</label>
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "4px 14px", display: "flex", alignItems: "center" }}>
              <input 
                type="email" 
                value={userProfile.email} 
                onChange={(e) => setUserProfile({ ...userProfile, email: e.target.value })}
                placeholder="Email Address"
                style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none" }}
              />
            </div>
          </div>

          {/* Phone Input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#64748b" }}>Phone Number</label>
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "4px 14px", display: "flex", alignItems: "center" }}>
              <input 
                type="tel" 
                value={userProfile.phone} 
                onChange={(e) => setUserProfile({ ...userProfile, phone: e.target.value })}
                placeholder="Phone Number"
                style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none" }}
              />
            </div>
          </div>

          {/* UPI ID Input */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <label style={{ fontSize: "12px", fontWeight: "700", color: "#64748b" }}>Configured UPI ID</label>
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "14px", border: "1.5px solid #e2e8f0", padding: "4px 14px", display: "flex", alignItems: "center" }}>
              <input 
                type="text" 
                value={storeSettings.upiId} 
                onChange={(e) => setStoreSettings({ ...storeSettings, upiId: e.target.value })}
                placeholder="UPI ID"
                style={{ width: "100%", padding: "10px 0", border: "none", background: "transparent", fontSize: "14px", fontWeight: "700", color: "#1e293b", outline: "none" }}
              />
            </div>
          </div>

        </div>

        {/* Save Changes Button */}
        <button 
          onClick={async () => {
            const currentUid = auth.currentUser?.uid || localStorage.getItem("uid");
            if (!currentUid) return;
            try {
              const userDocRef = doc(db, "users", currentUid);
              await setDoc(userDocRef, { 
                name: userProfile.name, 
                storeName: userProfile.storeName,
                email: userProfile.email,
                phone: userProfile.phone,
                profileImage: userProfile.profileImage,
                settings: storeSettings 
              }, { merge: true });
              setPopupModal({ show: true, message: "Profile Saved Successfully! ✅" });
            } catch (err) {
              alert("Error saving profile: " + err.message);
            }
          }} 
          style={{ width: "100%", padding: "14px", backgroundColor: "#6366f1", color: "#fff", border: "none", borderRadius: "14px", fontWeight: "800", fontSize: "15px", cursor: "pointer", boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)", textAlign: "center" }}
        >
          Save Changes
        </button>

        {/* Logout Button */}
        <button 
          onClick={handleLogout} 
          style={{ width: "100%", padding: "14px", backgroundColor: "#ff3b30", color: "#fff", border: "none", borderRadius: "14px", fontWeight: "800", fontSize: "15px", cursor: "pointer", boxShadow: "0 4px 12px rgba(255, 59, 48, 0.3)", textAlign: "center" }}
        >
          Logout
        </button>

      </div>
    </div>
  );
}