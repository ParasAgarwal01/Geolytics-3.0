import Cookies from 'js-cookie';


export const getEnabledFeatures =()=>{
    try{
        const data = Cookies.get('userInfo');
        console.log(data,'data')
        return data?JSON.parse(data):
        null
    }
    catch{
        return null
    }
}

export function getToken() {
    try {
        const userInfo = JSON.parse(Cookies.get("userInfo") || "{}");
        return userInfo.token || '';
    } catch (err) {
        return '';
    }
}
